/**
 * Dist-level import check (issue #32): `vp run check:dist`, a root task that
 * depends on every package's `build`.
 *
 * For every published package and every subpath its `publishConfig.exports`
 * declares, imports the BUILT `dist/*.js` under real Node ESM (never the
 * `src` the vitest suites resolve) and asserts that every value export its
 * bundled `.d.ts` promises exists at runtime. This is the check that catches
 * a bundler folding an `export *` into an internal object — the gateway's
 * `RerankerModel` re-export shipped that way in 0.1.x, so
 * `import { make } from "@thomasfosterau/effect-ai-gateway"` threw a
 * `SyntaxError` under Node while every src-level test passed.
 *
 * Every published package's bundled `dist/**\/*.d.ts` is also TYPE-CHECKED
 * with `skipLibCheck: false` (#111), keeping only diagnostics located in
 * that package's own `dist`: a declaration bundler can emit a reference to a
 * namespace the bundle never declares, which the value-export check cannot
 * see (see `checkDeclarations`).
 *
 * The gateway's built declarations are also compiled against a Worker-shaped
 * probe with `@cloudflare/workers-types` loaded, proving a Worker's `env.AI`
 * is accepted unchanged (see `checkWorkersBinding`).
 *
 * Every published package that declares a `bin` is also PACKED (`pnpm pack`),
 * unpacked into `node_modules/` of a scratch directory and its bin launched
 * from there (issue #42). Node refuses to type-strip TypeScript under
 * `node_modules`, so a bin that runs `src/*.ts` works from the workspace
 * (whose real path is outside `node_modules`) and fails for every consumer;
 * only a launch from an installed path proves the bin is built JavaScript.
 *
 * Workspace siblings (`@thomasfosterau/*`) resolve to their own `dist` through
 * `dist-resolve-hook.mjs` (installed in-thread with `module.registerHooks()`,
 * #72); everything else resolves as in a consumer's
 * `node_modules`. The expected export names come from the TypeScript checker
 * over each emitted declaration file (value symbols only — types and
 * type-only namespaces have no runtime presence).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { makeDistResolve } from "./dist-resolve-hook.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(root, "packages");

/** Every published package's built subpath entries. */
const targets = [];
/** Every published package's directory and manifest. */
const published = [];
for (const dir of readdirSync(packagesDir).sort()) {
  const manifest = JSON.parse(readFileSync(path.join(packagesDir, dir, "package.json"), "utf8"));
  if (manifest.private) continue;
  published.push({ dir: path.join(packagesDir, dir), manifest });
  for (const [subpath, conditions] of Object.entries(manifest.publishConfig.exports)) {
    const specifier = subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
    targets.push({
      specifier,
      js: path.join(packagesDir, dir, conditions.import),
      dts: path.join(packagesDir, dir, conditions.types),
    });
  }
}

registerHooks({
  resolve: makeDistResolve(new Map(targets.map((t) => [t.specifier, t.js]))),
});

/** Value export names the declaration file promises, via the TS checker. */
const expectedValueExports = (dts) => {
  const program = ts.createProgram([dts], {
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(dts);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`no module symbol for ${dts}`);
  return checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return (target.flags & ts.SymbolFlags.Value) !== 0;
    })
    .map((symbol) => symbol.getName())
    .sort();
};

let failures = 0;
for (const { specifier, dts } of targets) {
  const expected = expectedValueExports(dts);
  try {
    const runtime = new Set(Object.keys(await import(specifier)));
    const missing = expected.filter((name) => !runtime.has(name));
    if (missing.length > 0) {
      failures++;
      console.error(`FAIL ${specifier}: declared but missing at runtime: ${missing.join(", ")}`);
    } else {
      console.log(`ok   ${specifier} (${expected.length} value exports)`);
    }
  } catch (error) {
    failures++;
    console.error(`FAIL ${specifier}: ${String(error)}`);
  }
}

/**
 * Type-checks every bundled `dist/**\/*.d.ts` of the package in `dir` with
 * `skipLibCheck: false`, as a strict consumer's compiler would (#111). The
 * value-export check above cannot see a broken declaration: the gateway's
 * bundle once typed two exports as `RerankerModel_d_exports.Service`, a
 * namespace it never declared: "Cannot find namespace" (TS2503, or TS2833
 * when the checker can suggest a name) for every consumer with
 * `skipLibCheck: false`, and a silently degraded type for everyone else.
 *
 * Only diagnostics located in this package's own `dist` count. Third-party
 * declarations can raise their own noise under `skipLibCheck: false`, which
 * is not this package's to fix. Workspace siblings resolve to their built `.d.ts`
 * through `paths`, never the `src` their development `exports` point at.
 *
 * No package loads ambient `types`: a consumer's compiler has only what it
 * installs and lists itself, so a bundle must not lean on any package's
 * globals (`node`, or an optional peer such as `@cloudflare/workers-types`).
 * The gateway is therefore checked without workers-types, which proves its
 * `.d.ts` self-contained: it types the Worker binding with its own structural
 * slice rather than that package's ambient `Ai`, `AIGatewayProviders` and
 * `AIGatewayUniversalRequest` (#113). `lib` is pinned to the one
 * `tsconfig.base.json` sets (`esnext`, `dom`, `dom.iterable`) rather than
 * left to the target's default: bundles name DOM globals the runtimes they
 * target provide (`Response` in the gateway, `Blob` in elevenlabs).
 */
const parsedSources = new Map();
const checkDeclarations = (dir, paths) => {
  const distDir = path.join(dir, "dist");
  const rootNames = readdirSync(distDir, { recursive: true })
    .filter((f) => f.endsWith(".d.ts"))
    .map((f) => path.join(distDir, f));
  const options = {
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
    skipLibCheck: false,
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    paths,
  };
  const host = ts.createCompilerHost(options);
  // Third-party declarations resolve from the package directory, where its
  // dependencies are installed.
  host.getCurrentDirectory = () => dir;
  // One parse of each shared declaration file (effect's, mostly) serves
  // every package's program.
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, ...rest) => {
    let source = parsedSources.get(fileName);
    if (source === undefined) {
      source = getSourceFile(fileName, ...rest);
      if (source !== undefined) parsedSources.set(fileName, source);
    }
    return source;
  };
  const program = ts.createProgram({ rootNames, options, host });
  // Only the package's own files are checked (not filtered after a full
  // check), so effect's thousands of declarations are bound but never
  // walked: the check costs a few seconds, not a minute.
  const own = program
    .getSourceFiles()
    .flatMap((source) =>
      source.fileName.startsWith(`${distDir}/`)
        ? [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
        : [],
    );
  return {
    files: rootNames.length,
    diagnostics: [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics(), ...own],
  };
};

/** Every workspace specifier → its built declaration file, for `paths`. */
const distPaths = Object.fromEntries(targets.map((t) => [t.specifier, [t.dts]]));

for (const { dir, manifest } of published) {
  const { files, diagnostics } = checkDeclarations(dir, distPaths);
  if (diagnostics.length > 0) {
    failures++;
    console.error(
      `FAIL ${manifest.name} .d.ts type-check (skipLibCheck: false):\n` +
        ts.formatDiagnostics(diagnostics, {
          getCanonicalFileName: (f) => f,
          getCurrentDirectory: () => root,
          getNewLine: () => "\n",
        }),
    );
  } else {
    console.log(`ok   ${manifest.name} .d.ts type-check (${files} files)`);
  }
}

/**
 * Compiles a Worker-shaped probe against the gateway's BUILT `dist/index.d.ts`
 * with `@cloudflare/workers-types` loaded (and no `lib.dom`, as a Workers
 * project is configured), expecting no diagnostics: a Worker's `env.AI`,
 * typed `Ai` by that package, is accepted unchanged wherever the gateway
 * takes a binding (#113). `tests/workers-types-binding.test.ts` proves the
 * same against `src`; this proves the declaration bundler kept it so. The
 * probe is a virtual file beside the gateway, so workers-types (its
 * devDependency) resolves from there.
 */
const checkWorkersBinding = (dir, paths) => {
  const probe = path.join(dir, "check-dist-workers-binding.ts");
  const text = `
import {
  anthropicLanguageModelLayer,
  gatewayRun,
  gatewayUrl,
  makeCohereEmbeddingModel,
  makeCohereReranker,
  makeOpenAiModerationModel,
  type GatewayBinding,
} from "@thomasfosterau/effect-ai-gateway";

declare const env: { readonly AI: Ai };
const binding: GatewayBinding = { ai: env.AI, gatewayId: "website" };
export const probes = [
  gatewayUrl({ ai: env.AI, gatewayId: "website" }, "anthropic"),
  gatewayRun(binding, { provider: "cohere", endpoint: "v2/rerank", headers: {}, query: {} }),
  anthropicLanguageModelLayer(binding, { model: "claude" }),
  makeCohereEmbeddingModel(binding, { inputType: "search_query" }),
  makeCohereReranker(binding),
  makeOpenAiModerationModel(binding),
];
`;
  const options = {
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
    skipLibCheck: true,
    lib: ["lib.esnext.d.ts"],
    types: ["@cloudflare/workers-types"],
    paths,
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => dir;
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === probe
      ? ts.createSourceFile(fileName, text, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName === probe || fileExists(fileName);
  const program = ts.createProgram({ rootNames: [probe], options, host });
  const source = program.getSourceFile(probe);
  const diagnostics = [
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ];
  // A probe that silently resolved the gateway from anywhere but its dist
  // would prove nothing.
  const dts = path.join(dir, "dist", "index.d.ts");
  if (program.getSourceFile(dts) === undefined) {
    throw new Error(`probe did not load ${path.relative(root, dts)}`);
  }
  return diagnostics;
};

const gateway = published.find(
  ({ manifest }) => manifest.name === "@thomasfosterau/effect-ai-gateway",
);
if (gateway !== undefined) {
  try {
    const diagnostics = checkWorkersBinding(gateway.dir, distPaths);
    if (diagnostics.length > 0) {
      failures++;
      console.error(
        `FAIL ${gateway.manifest.name} accepts a workers-types \`Ai\` binding:\n` +
          ts.formatDiagnostics(diagnostics, {
            getCanonicalFileName: (f) => f,
            getCurrentDirectory: () => root,
            getNewLine: () => "\n",
          }),
      );
    } else {
      console.log(`ok   ${gateway.manifest.name} accepts a workers-types \`Ai\` binding`);
    }
  } catch (error) {
    failures++;
    console.error(`FAIL ${gateway.manifest.name} workers-types binding probe: ${String(error)}`);
  }
}

/**
 * Packs `dir`, unpacks the tarball into `<scratch>/node_modules/<name>` (a real
 * copy, so its real path is under `node_modules`), links its peer and
 * dev-time dependencies in from the workspace, and launches each bin with
 * `--help`.
 */
const checkPackedBin = (dir, manifest) => {
  const scratch = mkdtempSync(path.join(tmpdir(), "check-dist-bin-"));
  try {
    const packed = spawnSync("pnpm", ["pack", "--pack-destination", scratch], {
      cwd: dir,
      encoding: "utf8",
    });
    if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`);
    const tarball = readdirSync(scratch).find((f) => f.endsWith(".tgz"));
    if (tarball === undefined) throw new Error("pnpm pack produced no tarball");

    const installed = path.join(scratch, "node_modules", ...manifest.name.split("/"));
    mkdirSync(installed, { recursive: true });
    const untar = spawnSync(
      "tar",
      ["-xzf", path.join(scratch, tarball), "-C", installed, "--strip-components=1"],
      { encoding: "utf8" },
    );
    if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);

    // The tarball's own dependencies resolve to the workspace's copies, linked
    // beside the package exactly as an install would place them.
    const requested = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}).filter((n) => n === "@effect/platform-node"),
    ];
    for (const name of new Set(requested)) {
      const source = path.join(dir, "node_modules", ...name.split("/"));
      if (!existsSync(source)) continue;
      const link = path.join(scratch, "node_modules", ...name.split("/"));
      mkdirSync(path.dirname(link), { recursive: true });
      symlinkSync(source, link, "dir");
    }

    for (const [bin, rel] of Object.entries(manifest.bin)) {
      const result = spawnSync(process.execPath, [path.join(installed, rel), "--help"], {
        cwd: scratch,
        encoding: "utf8",
      });
      if (result.status !== 0 || result.stderr !== "" || !result.stdout.includes(bin)) {
        throw new Error(
          `bin ${bin} failed from an installed path (exit ${result.status}):\n${result.stderr || result.stdout}`,
        );
      }
      console.log(`ok   ${manifest.name} bin ${bin} (from node_modules)`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

for (const dirName of readdirSync(packagesDir).sort()) {
  const dir = path.join(packagesDir, dirName);
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  if (manifest.private || manifest.bin === undefined) continue;
  try {
    checkPackedBin(dir, manifest);
  } catch (error) {
    failures++;
    console.error(`FAIL ${manifest.name} bin: ${String(error)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} dist entr${failures === 1 ? "y" : "ies"} failed`);
  process.exit(1);
}
