/**
 * @copyright Thomas Foster
 *
 * A Node module-resolution hook that lets the `effect-evals` CLI load the
 * consumer's plain TypeScript under Node: every `*.eval.ts` file it
 * discovers, wherever in a workspace those live, which may use this repo's
 * extensionless-import house style (e.g. `import * as Cache from "../Cache"`).
 * The CLI itself runs from its built `dist/`, so the hook no longer serves
 * the CLI's own source. `bin/effect-evals.js` invokes Node
 * (type-stripping) and `--import ./loader.mjs` (this file, self-installing —
 * see the `registerHooks()` call at the bottom) as literal argv on a single `node`
 * invocation, per docs/decisions/run-the-toolchain-under-node.md. Node's
 * transform handles the TypeScript syntax; it does not resolve extensionless
 * or directory specifiers, which is the gap this hook fills — and nothing
 * else: everything under `node_modules` is left to Node's default resolver,
 * untouched.
 *
 * The hook is installed with the synchronous, in-thread
 * `module.registerHooks()` (Node 22.15+; the package's `engines.node` floor is
 * 22.18, for default type stripping),
 * not the off-thread `module.register()`, which Node 26 deprecates (DEP0205,
 * #72).
 *
 * This is a small, self-contained copy of the same strategy
 * the Alchemy stack once used (since retired — that graph's imports are all
 * extension-bearing now), kept local to this
 * package (no `$lib`-style alias support, which that one needs and this one
 * doesn't) so `effect-evals` stays extractable to its own repository with no
 * dependency on this repo's root tooling.
 *
 * @module cli/loader
 */
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];

const isFile = (candidate) => {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};
const isRelativeSpecifier = (specifier) =>
  specifier.startsWith("./") || specifier.startsWith("../");
const isRepoUrl = (url) => url.startsWith("file://") && !url.includes("/node_modules/");

/** Resolve `base` to a concrete file: itself, `base+ext`, or `base/index+ext`. */
function probe(base) {
  const candidates = [
    base,
    ...EXTS.map((ext) => base + ext),
    ...EXTS.map((ext) => `${base}/index${ext}`),
  ];
  return candidates.find(isFile) ?? null;
}

/** Resolves `specifier` (relative to `parentURL`) to an absolute file path, or `null` if this hook doesn't apply to it. */
function resolveRepoFile(specifier, parentURL = "") {
  if (!isRelativeSpecifier(specifier)) return null;
  if (!isRepoUrl(parentURL)) return null;

  const base = new URL(specifier, parentURL);
  if (base.protocol !== "file:") return null;

  // fileURLToPath, not base.pathname directly — pathname is percent-encoded
  // (a space in the repo path would otherwise never match a real file).
  return probe(fileURLToPath(base));
}

/** Synchronous `resolve` hook for `module.registerHooks()`. */
export function resolve(specifier, context, nextResolve) {
  const hit = resolveRepoFile(specifier, context.parentURL);
  if (hit === null) return nextResolve(specifier, context);
  return { url: pathToFileURL(hit).href, shortCircuit: true };
}

registerHooks({ resolve });
