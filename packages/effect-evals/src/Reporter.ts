/**
 * @copyright Thomas Foster
 *
 * `Reporter` — a named sink for a completed {@link Result.SuiteResult}.
 * {@link Runner.runSuite} invokes every reporter it's given after a suite
 * finishes; a reporter never fails the run — each implementation here
 * catches its own errors and logs a warning instead, so `report`'s error
 * channel is always `never`. A reporter's own dependencies (the JSON
 * reporter's `FileSystem`) are provided via `Layer`/`Effect.provide` at the
 * call site, exactly like a {@link Scorer.Scorer}'s judge model — see the
 * website repo's `docs/decisions/effect-evals-as-the-evaluation-toolkit.md`.
 *
 * `json`'s output is the {@link Result.SuiteResult} shape verbatim, `JSON.stringify`d:
 *
 * ```json
 * {
 *   "suite": "string",
 *   "passed": true,
 *   "durationMillis": 1234,
 *   "cases": [
 *     {
 *       "golden": "<the golden, as-is>",
 *       "trials": 3,
 *       "passed": true,
 *       "taskFailures": [{ "trial": 2, "error": "<the task's typed error>" }],
 *       "metrics": [
 *         {
 *           "metric": "exact-match",
 *           "passed": true,
 *           "errorCount": 0,
 *           "summary": { "mean": 0.8, "variance": 0.01, "stddev": 0.1, "min": 0.7, "max": 0.9 },
 *           "trials": [
 *             { "_tag": "Scored", "trial": 1, "cached": false, "score": { "score": 0.8, "reason": "..." } },
 *             { "_tag": "Errored", "trial": 2, "cached": false, "error": "<the metric's typed error>" }
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 * }
 * ```
 *
 * `summary` is `null` when every trial errored (no scores to summarize).
 *
 * @module Reporter
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "./Result.ts";

/** A named sink that consumes a completed suite's result; never fails. */
export interface Reporter<R = never> {
  readonly name: string;
  readonly report: (result: Result.SuiteResult) => Effect.Effect<void, never, R>;
}

/** Constructs a {@link Reporter} from its name and report function. */
export const makeReporter = <R = never>(options: Reporter<R>): Reporter<R> => options;

const passFail = (passed: boolean): string => (passed ? "PASS" : "FAIL");

/** Renders a {@link Result.SuiteResult} as a plain-text table: metric, score, pass/fail, reason, spread. */
export const formatTerminalTable = (result: Result.SuiteResult): string => {
  const lines: Array<string> = [
    `Suite: ${result.suite} — ${passFail(result.passed)} (${result.durationMillis}ms, ${result.cases.length} case${result.cases.length === 1 ? "" : "s"})`,
  ];
  for (const [index, caseResult] of result.cases.entries()) {
    lines.push(
      `  [${index}] ${passFail(caseResult.passed)} (${caseResult.trials} trial${caseResult.trials === 1 ? "" : "s"})`,
    );
    for (const taskFailure of caseResult.taskFailures) {
      lines.push(`      task failed (trial ${taskFailure.trial}): ${String(taskFailure.error)}`);
    }
    for (const metric of caseResult.metrics) {
      lines.push(
        `      ${metric.metric.padEnd(24)} ${passFail(metric.passed).padEnd(4)} ${Result.formatSpread(metric.summary).padEnd(40)} ${Result.lastReason(metric)}`,
      );
    }
  }
  return lines.join("\n");
};

/** Writes {@link formatTerminalTable}'s output to stdout. */
export const terminal: Reporter = makeReporter({
  name: "terminal",
  report: (result) => Effect.sync(() => console.log(formatTerminalTable(result))),
});

/** Writes the full {@link Result.SuiteResult} as JSON to `path` — see this module's doc comment for the schema. */
export const json = (path: string): Reporter<FileSystem.FileSystem> =>
  makeReporter({
    name: "json",
    report: (result) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const content = JSON.stringify(
          result,
          (key, value) => (key === "summary" && value === undefined ? null : value),
          2,
        );
        yield* fs.writeFileString(path, content);
      }).pipe(
        Effect.catch((error) => Effect.logWarning(`json reporter failed to write ${path}`, error)),
      ),
  });
