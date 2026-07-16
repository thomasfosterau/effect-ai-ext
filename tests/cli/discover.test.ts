/**
 * Unit tests for `cli/Discover.findEvalFiles`: default and custom glob
 * patterns, `node_modules` exclusion, deduplication across overlapping
 * patterns, and the `GlobError` mapping — against a real (temp-directory)
 * filesystem, since this module wraps Node's own `fs.promises.glob` rather
 * than effect's `FileSystem`.
 *
 * @module tests/cli/discover
 */

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { findEvalFiles, GlobError } from "../../src/cli/Discover";
import { expectFailureInstanceOf, runTest } from "@test-helpers/effect";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "effect-evals-discover-"));
  await mkdir(path.join(dir, "packages/jobs/evals"), { recursive: true });
  await mkdir(path.join(dir, "packages/jobs/evals/node_modules/evals"), { recursive: true });
  await mkdir(path.join(dir, "other"), { recursive: true });
  await writeFile(path.join(dir, "packages/jobs/evals/translate.eval.ts"), "");
  await writeFile(path.join(dir, "packages/jobs/evals/summarize.eval.ts"), "");
  await writeFile(path.join(dir, "packages/jobs/evals/node_modules/evals/vendored.eval.ts"), "");
  await writeFile(path.join(dir, "other/not-an-eval.ts"), "");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Discover.findEvalFiles", () => {
  it("matches the default-glob shape (**/evals/**/*.eval.ts), excluding node_modules", async () => {
    const files = await runTest(findEvalFiles(["**/evals/**/*.eval.ts"], dir));

    expect(files.slice().sort()).toEqual(
      [
        path.join(dir, "packages/jobs/evals/summarize.eval.ts"),
        path.join(dir, "packages/jobs/evals/translate.eval.ts"),
      ].sort(),
    );
  });

  it("resolves matches to absolute paths, deduplicated across overlapping patterns", async () => {
    const files = await runTest(findEvalFiles(["**/*.eval.ts", "packages/**/*.eval.ts"], dir));

    expect(files).toHaveLength(2);
    for (const file of files) expect(path.isAbsolute(file)).toBe(true);
  });

  it("returns an empty array when nothing matches", async () => {
    const files = await runTest(findEvalFiles(["**/*.does-not-exist"], dir));
    expect(files).toEqual([]);
  });

  it("fails with GlobError instead of throwing when the underlying glob call errors", async () => {
    // node:fs/promises' glob throws synchronously on a non-string cwd;
    // bypass the type system to exercise the catch-path without feeding
    // GlobError's own (schema-validated) `patterns` field bad data.
    const patterns = ["**/*.eval.ts"];
    const malformedCwd = 123 as unknown as string;

    const error = await expectFailureInstanceOf(findEvalFiles(patterns, malformedCwd), GlobError);
    expect(error.patterns).toEqual(patterns);
  });
});
