/**
 * Unit tests for `cli/Discover.findEvalFiles`: default and custom glob
 * patterns, `node_modules` exclusion, deduplication across overlapping
 * patterns, and the `GlobError` mapping — against a real (temp-directory)
 * filesystem, since this module wraps Node's own `fs.promises.glob` rather
 * than effect's `FileSystem`. The scratch tree is built and removed through
 * the Node `FileSystem` / `Path` services, scoped to each test.
 *
 * @module tests/cli/discover
 */

import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Order from "effect/Order";
import * as Path from "effect/Path";
import { NodeServices } from "@effect/platform-node";
import { findEvalFiles, GlobError } from "../../src/cli/Discover.ts";
import { expectFailureInstanceOf, runTest } from "../helpers/effect.ts";

const DIRECTORIES = [
  "packages/jobs/evals",
  "packages/jobs/evals/node_modules/evals",
  "other",
] as const;

const FILES = [
  "packages/jobs/evals/translate.eval.ts",
  "packages/jobs/evals/summarize.eval.ts",
  "packages/jobs/evals/node_modules/evals/vendored.eval.ts",
  "other/not-an-eval.ts",
] as const;

/** Builds the scratch tree in a temp directory the enclosing scope removes. */
const makeFixtureTree = Effect.fn("makeFixtureTree")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "effect-evals-discover-" });
  yield* Effect.forEach(
    DIRECTORIES,
    (relative) => fs.makeDirectory(path.join(dir, relative), { recursive: true }),
    { concurrency: 1, discard: true },
  );
  yield* Effect.forEach(FILES, (relative) => fs.writeFileString(path.join(dir, relative), ""), {
    concurrency: 1,
    discard: true,
  });
  return dir;
});

/** Runs `test` against a fresh scratch tree, with the Node platform services. */
const inFixtureTree = <A, E>(
  test: (dir: string, path: Path.Path) => Effect.Effect<A, E, Path.Path>,
): Promise<A> =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* makeFixtureTree();
      const path = yield* Path.Path;
      return yield* test(dir, path);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

describe("Discover.findEvalFiles", () => {
  it("matches the default-glob shape (**/evals/**/*.eval.ts), excluding node_modules", async () => {
    const { files, expected } = await inFixtureTree((dir, path) =>
      findEvalFiles(["**/evals/**/*.eval.ts"], dir).pipe(
        Effect.map((files) => ({
          files: Arr.sort(files, Order.String),
          expected: Arr.sort(
            [
              path.join(dir, "packages/jobs/evals/summarize.eval.ts"),
              path.join(dir, "packages/jobs/evals/translate.eval.ts"),
            ],
            Order.String,
          ),
        })),
      ),
    );

    expect(files).toEqual(expected);
  });

  it("resolves matches to absolute paths, deduplicated across overlapping patterns", async () => {
    const { files, absolute } = await inFixtureTree((dir, path) =>
      findEvalFiles(["**/*.eval.ts", "packages/**/*.eval.ts"], dir).pipe(
        Effect.map((files) => ({ files, absolute: Arr.map(files, path.isAbsolute) })),
      ),
    );

    expect(files).toHaveLength(2);
    expect(absolute).toEqual([true, true]);
  });

  it("returns an empty array when nothing matches", async () => {
    const files = await inFixtureTree((dir) => findEvalFiles(["**/*.does-not-exist"], dir));
    expect(files).toEqual([]);
  });

  it("fails with GlobError instead of throwing when the underlying glob call errors", async () => {
    // node:fs/promises' glob throws synchronously on a non-string cwd;
    // bypass the type system to exercise the catch-path without feeding
    // GlobError's own (schema-validated) `patterns` field bad data.
    const patterns = ["**/*.eval.ts"];
    const malformedCwd = 123 as unknown as string;

    const error = await expectFailureInstanceOf(
      findEvalFiles(patterns, malformedCwd).pipe(Effect.provide(NodeServices.layer)),
      GlobError,
    );
    expect(error.patterns).toEqual(patterns);
  });
});
