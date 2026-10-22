/**
 * The CLI's own combined report: every executed suite result across every
 * matched file, plus the files skipped for missing credentials and the
 * files that failed to load. Distinct from {@link Reporter.Reporter}
 * (`../Reporter.ts`), which is scoped to a single `Result.SuiteResult` — a
 * `run` invocation spans many files and many suites, so it needs its own
 * aggregate shape and its own JSON writer.
 *
 * @module cli/Report
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Result from "../Result.ts";

/** The default `--out` path, gitignored alongside the filesystem cache (`.effect-evals/`). */
export const DEFAULT_OUT_PATH = ".effect-evals/results.json";

/** Every suite result from one successfully-loaded and executed eval file. */
export interface FileResult {
  readonly file: string;
  readonly suites: ReadonlyArray<Result.SuiteResult>;
}

/** An eval file whose `layer` failed to build with a `Config.ConfigError` — its suites did not run. */
export interface SkippedFile {
  readonly file: string;
  readonly suites: ReadonlyArray<string>;
  readonly reason: string;
}

/** An eval file that failed to load/validate, or whose suites failed for a reason other than missing config. */
export interface FailedFile {
  readonly file: string;
  readonly error: string;
}

/** The full result of a `run` invocation. */
export interface CliReport {
  readonly ran: ReadonlyArray<FileResult>;
  readonly skipped: ReadonlyArray<SkippedFile>;
  readonly failed: ReadonlyArray<FailedFile>;
  readonly passed: boolean;
}

/**
 * `JSON.stringify` with two-space indentation, as a codec. The replacer writes
 * an absent `summary` as `null` rather than dropping the key.
 */
const encodeReportJson = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Unknown, {
    replacer: (key, value) => (key === "summary" && value === undefined ? null : value),
    space: 2,
  }),
);

/**
 * Writes `report` as JSON to `path_`, creating its parent directory if
 * needed. Never fails the run — mirrors `Reporter.json`'s own "a reporter
 * never fails the run" contract: a write failure logs a warning instead.
 */
export const writeJsonReport = (
  path_: string,
  report: CliReport,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.dirname(path_);
    // `recursive: true` is already a no-op when `dir` exists — no need to check first.
    if (dir !== "." && dir !== "") yield* fs.makeDirectory(dir, { recursive: true });

    const content = yield* encodeReportJson(report);
    yield* fs.writeFileString(path_, content);
  }).pipe(
    Effect.catch((error) => Effect.logWarning(`effect-evals: failed to write ${path_}`, error)),
  );
