/**
 * Glob discovery of `*.eval.ts` files for the `run` command. Uses Node's own
 * `fs.promises.glob` (stable as of the pinned Node version — see
 * the `engines.node` floor) rather than a dependency: this module is CLI-only and
 * already Node-coupled (dynamic `import()`, process argv), so pulling in a
 * userland glob package would buy nothing.
 *
 * @module cli/Discover
 *
 * @copyright Thomas Foster
 */

import { glob } from "node:fs/promises";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** A glob pattern failed to evaluate (a malformed pattern, an unreadable directory, …). */
export class GlobError extends Schema.TaggedError<GlobError>()("GlobError", {
  patterns: Schema.Array(Schema.String),
  cause: Schema.Defect(),
}) {}

// Matches "node_modules"/".git" as a whole path segment (start, middle, or
// end of the candidate) without allocating an array per call the way
// `candidate.split(path.sep)` would on this glob-walk hot path.
const SEP = path.sep === "\\" ? "\\\\" : path.sep;
const EXCLUDED_PATTERN = new RegExp(`(^|${SEP})(node_modules|\\.git)(${SEP}|$)`);
const isExcluded = (candidate: string): boolean => EXCLUDED_PATTERN.test(candidate);

/**
 * Resolves every file matching any of `patterns` (relative to `cwd`,
 * default `process.cwd()`) to an absolute path, deduplicated and sorted for
 * deterministic run order. `node_modules` and `.git` are always excluded.
 */
export const findEvalFiles = (
  patterns: ReadonlyArray<string>,
  cwd: string = process.cwd(),
): Effect.Effect<ReadonlyArray<string>, GlobError> =>
  Effect.tryPromise({
    try: async () => {
      const matches = new Set<string>();
      for await (const match of glob([...patterns], { cwd, exclude: isExcluded })) {
        matches.add(path.resolve(cwd, match));
      }
      return Array.from(matches).sort();
    },
    catch: (cause) => new GlobError({ patterns: [...patterns], cause }),
  });
