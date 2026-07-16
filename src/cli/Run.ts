/**
 * @copyright Thomas Foster
 *
 * The framework-agnostic orchestration behind the `run` command: discover
 * eval files, load and validate each one, run its (optionally filtered)
 * suites through {@link Runner.runSuite}, and aggregate into a
 * {@link Report.CliReport}. Pure with respect to the CLI framework — no
 * `effect/unstable/cli` import here — so it's directly unit-testable and so
 * `RunCommand.ts` stays a thin flags-to-config translation.
 *
 * **Credential gating.** Each file's `layer` is built on its own, in its own
 * scope, before any of its suites run — see {@link runFile}. If *that build*
 * fails with a `Config.ConfigError`, the file's suites are recorded as
 * skipped (naming the missing config) rather than failing the run, per
 * `EvalFile.ts`'s "Credential gating" section. A `ConfigError` (or anything
 * else) surfacing from suite *execution* itself — a task or a dataset that
 * reads `Config` directly, bypassing `layer` — is a genuine failure, not a
 * skip: only the layer-construction step gets the credential-gating
 * exemption.
 *
 * `runEvals`'s only failure mode is a bug, not an expected outcome — a
 * discovery/load/run problem is always captured into the returned
 * {@link Report.CliReport} instead of failing the `Effect`. `Effect.result`
 * does not catch defects or interruptions, so a genuine defect (a thrown
 * value instead of a typed failure, deep inside a task or metric) still
 * propagates and fails this Effect — which is the correct outcome for an
 * actual bug, as opposed to an eval file failing to load or a suite missing
 * its threshold, both of which are ordinary, expected results here.
 *
 * @module cli/Run
 */

import { ConfigError } from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as EffectResult from "effect/Result";
import * as Cache from "../Cache";
import type * as EvalFile from "../EvalFile";
import * as Runner from "../Runner";
import { findEvalFiles, GlobError } from "./Discover";
import { EvalFileImportError, InvalidEvalFileError, loadEvalFile } from "./LoadEvalFile";
import type { CliReport, FailedFile, FileResult, SkippedFile } from "./Report";

/** The default glob when no `globs` argument is given. */
export const DEFAULT_GLOB = "**/evals/**/*.eval.ts";

/** The `run` command's parsed configuration, independent of how it was parsed. */
export interface RunConfig {
  readonly globs: ReadonlyArray<string>;
  readonly trials: Option.Option<number>;
  readonly concurrency: Option.Option<number>;
  readonly force: boolean;
  readonly filter: Option.Option<string>;
  readonly cwd?: string;
}

/** A human-readable message for any error this module handles — typed CLI errors get a precise reason; anything else falls back to its own message or a JSON dump. */
const describeError = (error: unknown): string => {
  if (error instanceof GlobError) return `glob discovery failed: ${describeError(error.cause)}`;
  if (error instanceof EvalFileImportError) return `import failed: ${describeError(error.cause)}`;
  if (error instanceof InvalidEvalFileError) return error.reason;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const buildRunnerOptions = (
  config: RunConfig,
  fileOptions: Runner.RunnerOptions | undefined,
): Runner.RunnerOptions => ({
  ...fileOptions,
  ...(Option.isSome(config.trials) ? { trials: config.trials.value } : {}),
  ...(Option.isSome(config.concurrency)
    ? { caseConcurrency: config.concurrency.value, metricConcurrency: config.concurrency.value }
    : {}),
  ...(config.force ? { bypassCache: true } : {}),
});

/** One matched file's outcome: its suites ran, were skipped (missing credentials), or failed outright. */
type FileOutcome =
  | { readonly _tag: "Ran"; readonly result: FileResult }
  | { readonly _tag: "Skipped"; readonly result: SkippedFile }
  | { readonly _tag: "Failed"; readonly result: FailedFile };

/**
 * Runs one eval file's (optionally filtered) suites: builds `layer` in its
 * own scope first — a `Config.ConfigError` here, and only here, is the
 * credential-gating skip — then runs every suite against the built context.
 * Any failure once suites are actually running (including a `ConfigError`
 * from a suite's own dataset/task/metric, not `layer`) is a hard failure.
 */
const runFile = <R>(
  file: string,
  suites: ReadonlyArray<EvalFile.AnySuite>,
  layer: Layer.Layer<R, unknown>,
  runnerOptions: Runner.RunnerOptions,
): Effect.Effect<FileOutcome, never, Cache.KeyValueStore.KeyValueStore> =>
  Effect.scoped(
    Effect.gen(function* () {
      const built = yield* Effect.result(Layer.build(layer));

      if (EffectResult.isFailure(built)) {
        const error = built.failure;
        return error instanceof ConfigError
          ? {
              _tag: "Skipped" as const,
              result: {
                file,
                suites: suites.map((suite) => suite.name),
                reason: error.message,
              },
            }
          : { _tag: "Failed" as const, result: { file, error: describeError(error) } };
      }

      const outcome = yield* Effect.result(
        Effect.forEach(suites, (suite) => Runner.runSuite(suite, runnerOptions), {
          concurrency: 1,
        }).pipe(Effect.provideContext(built.success)),
      );

      return EffectResult.isFailure(outcome)
        ? { _tag: "Failed" as const, result: { file, error: describeError(outcome.failure) } }
        : { _tag: "Ran" as const, result: { file, suites: outcome.success } };
    }),
  );

/** `runFile`'s result, plus "NoMatch" for a file whose suites were all excluded by `--filter`. */
type ProcessedFile = FileOutcome | { readonly _tag: "NoMatch" };

/** Loads one file, applies `--filter`, and (if anything matched) runs it via {@link runFile}. */
const processFile = (
  file: string,
  config: RunConfig,
  filterSubstring: string | undefined,
): Effect.Effect<ProcessedFile, never, Cache.KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const loaded = yield* Effect.result(loadEvalFile(file));
    if (EffectResult.isFailure(loaded)) {
      return { _tag: "Failed" as const, result: { file, error: describeError(loaded.failure) } };
    }
    const evalFile = loaded.success;

    const suites =
      filterSubstring === undefined
        ? evalFile.suites
        : evalFile.suites.filter((suite) => suite.name.includes(filterSubstring));
    if (suites.length === 0) return { _tag: "NoMatch" as const };

    const runnerOptions = buildRunnerOptions(config, evalFile.options);
    return yield* runFile(file, suites, evalFile.layer, runnerOptions);
  });

/** Discovers, loads, and runs every matched eval file's (optionally filtered) suites; see the module doc for the failure/defect distinction. */
export const runEvals = (
  config: RunConfig,
): Effect.Effect<CliReport, never, Cache.KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const patterns = config.globs.length > 0 ? config.globs : [DEFAULT_GLOB];
    const filesResult = yield* Effect.result(findEvalFiles(patterns, config.cwd));

    if (EffectResult.isFailure(filesResult)) {
      return {
        ran: [],
        skipped: [],
        failed: [{ file: patterns.join(", "), error: describeError(filesResult.failure) }],
        passed: false,
      };
    }

    const filterSubstring = Option.getOrUndefined(config.filter);
    const ran: Array<FileResult> = [];
    const skipped: Array<SkippedFile> = [];
    const failed: Array<FailedFile> = [];

    for (const file of filesResult.success) {
      const outcome = yield* processFile(file, config, filterSubstring);
      if (outcome._tag === "Ran") ran.push(outcome.result);
      else if (outcome._tag === "Skipped") skipped.push(outcome.result);
      else if (outcome._tag === "Failed") failed.push(outcome.result);
    }

    const passed = failed.length === 0 && ran.every((f) => f.suites.every((s) => s.passed));

    return { ran, skipped, failed, passed };
  });
