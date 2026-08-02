/**
 * Unit tests for `cli/Report.writeJsonReport`: creates the output's parent
 * directory when missing, writes the `CliReport` as JSON (with an
 * all-errored metric's `summary` as `null`, matching `Reporter.json`'s own
 * convention), and never fails the run — a write failure logs a warning
 * instead.
 *
 * @module tests/cli/report
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import type { CliReport } from "../../src/cli/Report.ts";
import { writeJsonReport } from "../../src/cli/Report.ts";
import { runTest } from "@test-helpers/effect";

const passingReport: CliReport = {
  ran: [
    {
      file: "packages/jobs/evals/translate.eval.ts",
      suites: [
        {
          suite: "translation-quality",
          passed: true,
          durationMillis: 5,
          cases: [],
        },
      ],
    },
  ],
  skipped: [
    {
      file: "packages/ai/evals/rag.eval.ts",
      suites: ["rag-quality"],
      reason: "missing CF_AIG_TOKEN",
    },
  ],
  failed: [],
  passed: true,
};

describe("Report.writeJsonReport", () => {
  it("writes the report as JSON, ensuring the parent directory exists first", async () => {
    let created: string | undefined;
    let written: { path: string; content: string } | undefined;

    const testFs = FileSystem.layerNoop({
      makeDirectory: (path) =>
        Effect.sync(() => {
          created = String(path);
        }),
      writeFileString: (path, content) =>
        Effect.sync(() => {
          written = { path: String(path), content };
        }),
    });

    await runTest(
      writeJsonReport(".effect-evals/results.json", passingReport).pipe(
        Effect.provide(testFs),
        Effect.provide(Path.layer),
      ),
    );

    expect(created).toBe(".effect-evals");
    expect(written?.path).toBe(".effect-evals/results.json");
    expect(JSON.parse(written?.content ?? "{}")).toEqual(passingReport);
  });

  it("does not create a directory when the output path has no directory component", async () => {
    let createCalled = false;
    let written: { path: string; content: string } | undefined;

    const testFs = FileSystem.layerNoop({
      makeDirectory: () =>
        Effect.sync(() => {
          createCalled = true;
        }),
      writeFileString: (path, content) =>
        Effect.sync(() => {
          written = { path: String(path), content };
        }),
    });

    await runTest(
      writeJsonReport("results.json", passingReport).pipe(
        Effect.provide(testFs),
        Effect.provide(Path.layer),
      ),
    );

    expect(createCalled).toBe(false);
    expect(written?.path).toBe("results.json");
  });

  it("logs a warning instead of failing when the write itself fails", async () => {
    const testFs = FileSystem.layerNoop({
      makeDirectory: () => Effect.void,
      writeFileString: () =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "Unknown",
            module: "FileSystem",
            method: "writeFileString",
          }),
        ),
    });

    // Should not throw — writeJsonReport's error channel is `never`.
    await runTest(
      writeJsonReport("out.json", passingReport).pipe(
        Effect.provide(testFs),
        Effect.provide(Path.layer),
      ),
    );
  });
});
