/**
 * Glob discovery of `*.eval.ts` files for the `run` command. Uses Node's own
 * `fs.promises.glob` (stable as of the pinned Node version — see
 * the `engines.node` floor) rather than a dependency: this module is CLI-only and
 * already Node-coupled (dynamic `import()`, process argv), so pulling in a
 * userland glob package would buy nothing. Effect's `FileSystem` service has
 * no glob, so this is the one direct `node:fs` import (the root lint config
 * exempts this file from `use-filesystem-service`); paths go through the
 * `Path` service.
 *
 * @module cli/Discover
 *
 * @copyright Thomas Foster
 */

import { glob } from "node:fs/promises";
import * as Order from "effect/Order";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/** A glob pattern failed to evaluate (a malformed pattern, an unreadable directory, …). */
export class GlobError extends Schema.TaggedError<GlobError>()("GlobError", {
  patterns: Schema.Array(Schema.String),
  cause: Schema.Defect(),
}) {}

/**
 * Matches "node_modules"/".git" as a whole path segment (start, middle, or
 * end of the candidate) without allocating an array per call the way
 * `candidate.split(sep)` would on this glob-walk hot path.
 */
const excludedMatcher = (sep: string): ((candidate: string) => boolean) => {
  const escaped = sep === "\\" ? "\\\\" : sep;
  const pattern = new RegExp(`(^|${escaped})(node_modules|\\.git)(${escaped}|$)`);
  return (candidate) => pattern.test(candidate);
};

/**
 * Resolves every file matching any of `patterns` (relative to `cwd`,
 * default `process.cwd()`) to an absolute path, deduplicated and sorted for
 * deterministic run order. `node_modules` and `.git` are always excluded.
 */
export const findEvalFiles = (
  patterns: ReadonlyArray<string>,
  cwd: string = process.cwd(),
): Effect.Effect<ReadonlyArray<string>, GlobError, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const exclude = excludedMatcher(path.sep);
    return yield* Effect.tryPromise({
      try: async () => {
        const matches = await Array.fromAsync(glob([...patterns], { cwd, exclude }));
        return Arr.sort(
          Arr.dedupe(Arr.map(matches, (match) => path.resolve(cwd, match))),
          Order.String,
        );
      },
      catch: (cause) => new GlobError({ patterns: [...patterns], cause }),
    });
  });
