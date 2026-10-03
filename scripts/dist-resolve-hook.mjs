/**
 * Node module-resolution hook for `check-dist.mjs`: resolves every
 * `@thomasfosterau/<package>[/<subpath>]` specifier to that workspace
 * package's BUILT entry, read from its `publishConfig.exports` — the manifest
 * a consumer actually installs — instead of the `./src/*.ts` development
 * `exports`. Everything else (`effect`, `@effect/*`, …) goes to Node's default
 * resolver, so the bundles load exactly as they would from `node_modules`.
 *
 * `check-dist.mjs` installs it in-thread with `module.registerHooks()` (#72),
 * which has no `initialize` / `data` channel, so the entries map arrives by
 * closure.
 */
import { pathToFileURL } from "node:url";

/**
 * Builds a synchronous `resolve` hook over `entries`.
 *
 * @param {Map<string, string>} entries specifier → absolute file path
 */
export const makeDistResolve = (entries) => (specifier, context, nextResolve) => {
  const target = entries.get(specifier);
  if (target !== undefined) {
    return { url: pathToFileURL(target).href, format: "module", shortCircuit: true };
  }
  return nextResolve(specifier, context);
};
