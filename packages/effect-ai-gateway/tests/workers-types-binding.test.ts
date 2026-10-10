/**
 * Type-level proof that the gateway's local binding types (#113) accept a
 * real Workers binding.
 *
 * `src/Binding.ts` types the Worker's `AI` binding with its own structural
 * slice (`WorkersAiBinding`) instead of `@cloudflare/workers-types`' ambient
 * `Ai`, so the published declarations need nothing from that package. This
 * suite compiles probes, as a Worker would write them, in a program that
 * loads `@cloudflare/workers-types` (the installed devDependency) with no
 * `lib.dom`, as a Workers project is configured. The accepting probe must
 * type-check: an `env.AI` typed `Ai` passes wherever the gateway takes a
 * binding, and the workers-types provider and request types line up with the
 * local ones. The rejecting probe must not, so a program that stopped
 * checking anything would fail the suite too.
 *
 * The probes live in strings, compiled as virtual files beside this one: the
 * suites run type-stripped and this package's `tsconfig.json` checks `src`
 * only, without workers-types, so no other gate sees them.
 *
 * @module tests/workers-types-binding
 */

import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

/** This package's directory, where `@cloudflare/workers-types` is installed. */
const packageDir = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
const acceptsFile = `${packageDir}/tests/workers-types-binding.accepts.ts`;
const rejectsFile = `${packageDir}/tests/workers-types-binding.rejects.ts`;

const ACCEPTS = `
import {
  anthropicLanguageModelLayer,
  gatewayRun,
  gatewayUrl,
  makeCohereEmbeddingModel,
  makeCohereReranker,
  makeOpenAiModerationModel,
  type GatewayBinding,
  type GatewayProvider,
  type GatewayUniversalRequest,
  type WorkersAiBinding,
  type WorkersAiGateway,
} from "@thomasfosterau/effect-ai-gateway";

interface Env {
  readonly AI: Ai;
}
declare const env: Env;

// A Worker's binding is assignable to the local slice, directly and inside
// the { ai, gatewayId } pair every provider takes.
export const ai: WorkersAiBinding = env.AI;
export const gateway: WorkersAiGateway = env.AI.gateway("website");
export const binding: GatewayBinding = { ai: env.AI, gatewayId: "website" };

// Passed straight through, as the README shows.
export const url = gatewayUrl({ ai: env.AI, gatewayId: "website" }, "anthropic");
export const run = gatewayRun(binding, {
  provider: "cohere",
  endpoint: "v2/rerank",
  headers: { "content-type": "application/json" },
  query: {},
});
export const anthropic = anthropicLanguageModelLayer(binding, { model: "claude" });
export const embeddings = makeCohereEmbeddingModel(binding, { inputType: "search_query" });
export const reranker = makeCohereReranker(binding);
export const moderation = makeOpenAiModerationModel(binding);

// Every workers-types provider slug is a GatewayProvider, and the request
// gatewayRun sends is one the binding's run() accepts.
declare const known: AIGatewayProviders;
export const provider: GatewayProvider = known;
declare const local: GatewayUniversalRequest;
export const universal: AIGatewayUniversalRequest = local;

// GatewayProvider's literal slugs are exactly workers-types' list, so a slug
// added to or dropped from either side fails here. The open string member is
// filtered out by shape (\`string\` extends it; no literal does): it accepts
// any string, so the slug assignment above alone can never catch drift.
type Literals<T> = T extends string ? (string extends T ? never : T) : never;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export const sameSlugs: Equals<Literals<GatewayProvider>, AIGatewayProviders> = true;

// A release whose run() options predate \`signal\` ({ gateway?, extraHeaders? })
// still fits: GatewayRunOptions names both, as never.
declare const olderGateway: {
  run(
    data: AIGatewayUniversalRequest,
    options?: { gateway?: UniversalGatewayOptions; extraHeaders?: object },
  ): Promise<Response>;
  getUrl(provider?: AIGatewayProviders | string): Promise<string>;
};
export const older: WorkersAiGateway = olderGateway;
`;

const REJECTS = `
import type { WorkersAiBinding } from "@thomasfosterau/effect-ai-gateway";

// A binding without gateway() is rejected.
declare const notABinding: { readonly run: Ai["run"] };
export const wrong: WorkersAiBinding = notABinding;
`;

const options: ts.CompilerOptions = {
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ESNext,
  lib: ["lib.esnext.d.ts"],
  types: ["@cloudflare/workers-types"],
  strict: true,
  exactOptionalPropertyTypes: true,
  skipLibCheck: true,
  noEmit: true,
};

/** Whether `fileName` is one of the virtual probe files. */
const isProbe = (fileName: string): boolean => fileName === acceptsFile || fileName === rejectsFile;

/** One program over both probes; `diagnostics(file)` formats one probe's errors. */
const compile = () => {
  const host = ts.createCompilerHost(options);
  // `types` resolve from the package directory, where workers-types is installed.
  host.getCurrentDirectory = () => packageDir;
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    isProbe(fileName)
      ? ts.createSourceFile(
          fileName,
          fileName === acceptsFile ? ACCEPTS : REJECTS,
          languageVersion,
          true,
        )
      : getSourceFile(fileName, languageVersion, ...rest);
  const fileExists = host.fileExists;
  host.fileExists = (fileName) => isProbe(fileName) || fileExists(fileName);
  const program = ts.createProgram({ rootNames: [acceptsFile, rejectsFile], options, host });
  const global = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
  return (fileName: string): string => {
    const source = program.getSourceFile(fileName);
    return ts.formatDiagnostics(
      [
        ...global,
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source),
      ],
      {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => packageDir,
        getNewLine: () => "\n",
      },
    );
  };
};

describe("a Workers `Ai` binding", () => {
  const diagnostics = compile();

  it("type-checks wherever the gateway takes a binding", () => {
    expect(diagnostics(acceptsFile)).toBe("");
  });

  it("is checked: a binding without gateway() is rejected", () => {
    expect(diagnostics(rejectsFile)).toMatch(/error TS2741: Property 'gateway' is missing/);
  });
});
