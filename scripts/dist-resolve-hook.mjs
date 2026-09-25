/**
 * Node module-resolution hook for `check-dist.mjs`: resolves every
 * `@thomasfosterau/<package>[/<subpath>]` specifier to that workspace
 * package's BUILT entry, read from its `publishConfig.exports` — the manifest
 * a consumer actually installs — instead of the `./src/*.ts` development
 * `exports`. Everything else (`effect`, `@effect/*`, …) goes to Node's default
 * resolver, so the bundles load exactly as they would from `node_modules`.
 */
import { pathToFileURL } from "node:url";

/** @type {Map<string, string>} specifier → absolute file path */
let entries = new Map();

export const initialize = (data) => {
  entries = new Map(data.entries);
};

export const resolve = async (specifier, context, nextResolve) => {
  const target = entries.get(specifier);
  if (target !== undefined) {
    return { url: pathToFileURL(target).href, format: "module", shortCircuit: true };
  }
  return nextResolve(specifier, context);
};
