/**
 * Unit tests for `Reporter`: the terminal table formatter, `terminal`'s
 * stdout sink, and `json`'s `FileSystem`-backed write (stubbed via
 * `FileSystem.layerNoop` — no real disk I/O).
 *
 * @module tests/reporter
 */

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import { Reporter, Result } from "../src/index.ts";
import { runTest } from "./helpers/effect.ts";

const passingResult: Result.SuiteResult = {
  suite: "greetings",
  passed: true,
  durationMillis: 42,
  cases: [
    {
      golden: { input: "Bonjour" },
      trials: 2,
      passed: true,
      taskFailures: [],
      metrics: [
        {
          metric: "exact-match",
          passed: true,
          errorCount: 0,
          summary: { mean: 0.9, variance: 0.01, stddev: 0.1, min: 0.8, max: 1 },
          trials: [
            { _tag: "Scored", trial: 1, cached: false, score: { score: 0.8, reason: "close" } },
            { _tag: "Scored", trial: 2, cached: true, score: { score: 1, reason: "exact" } },
          ],
        },
      ],
    },
  ],
};

describe("Reporter.formatTerminalTable", () => {
  it("renders the suite verdict, each case, and each metric row", () => {
    const table = Reporter.formatTerminalTable(passingResult);
    expect(table).toContain("greetings");
    expect(table).toContain("PASS");
    expect(table).toContain("exact-match");
    expect(table).toContain("exact");
  });

  it("surfaces task failures and errored metric trials", () => {
    const table = Reporter.formatTerminalTable({
      suite: "greetings",
      passed: false,
      durationMillis: 10,
      cases: [
        {
          golden: { input: "Bonjour" },
          trials: 1,
          passed: false,
          taskFailures: [{ trial: 1, error: "boom" }],
          metrics: [
            {
              metric: "exact-match",
              passed: false,
              errorCount: 1,
              summary: undefined,
              trials: [{ _tag: "Errored", trial: 1, cached: false, error: "judge unavailable" }],
            },
          ],
        },
      ],
    });
    expect(table).toContain("FAIL");
    expect(table).toContain("boom");
    expect(table).toContain("judge unavailable");
  });
});

describe("Reporter.terminal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the formatted table to stdout", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runTest(Reporter.terminal.report(passingResult));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain("greetings");
  });
});

describe("Reporter.json", () => {
  it("writes the result as JSON to the given path", async () => {
    let written: { path: string; content: string } | undefined;
    const testFs = FileSystem.layerNoop({
      writeFileString: (path, content) =>
        Effect.sync(() => {
          written = { path: String(path), content };
        }),
    });

    await runTest(
      Reporter.json("./results.json").report(passingResult).pipe(Effect.provide(testFs)),
    );

    expect(written?.path).toBe("./results.json");
    expect(JSON.parse(written?.content ?? "{}")).toEqual(passingResult);
  });

  it("writes an all-errored metric's summary as null, not an omitted key", async () => {
    const erroredResult: Result.SuiteResult = {
      suite: "greetings",
      passed: false,
      durationMillis: 5,
      cases: [
        {
          golden: { input: "Bonjour" },
          trials: 1,
          passed: false,
          taskFailures: [],
          metrics: [
            {
              metric: "exact-match",
              passed: false,
              errorCount: 1,
              summary: undefined,
              trials: [{ _tag: "Errored", trial: 1, cached: false, error: "judge unavailable" }],
            },
          ],
        },
      ],
    };

    let written = "";
    const testFs = FileSystem.layerNoop({
      writeFileString: (_path, content) =>
        Effect.sync(() => {
          written = content;
        }),
    });

    await runTest(
      Reporter.json("./results.json").report(erroredResult).pipe(Effect.provide(testFs)),
    );

    const parsed = JSON.parse(written) as {
      cases: Array<{ metrics: Array<Record<string, unknown>> }>;
    };
    expect(parsed.cases[0]?.metrics[0]).toHaveProperty("summary", null);
  });

  it("logs a warning instead of failing when the write fails", async () => {
    const testFs = FileSystem.layerNoop({
      writeFileString: () =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "Unknown",
            module: "FileSystem",
            method: "writeFileString",
          }),
        ),
    });

    // Should not throw — the reporter's error channel is `never`.
    await runTest(
      Reporter.json("./results.json").report(passingResult).pipe(Effect.provide(testFs)),
    );
  });
});
