/**
 * @copyright Thomas Foster
 *
 * The `vite-plus/test` runner adapter: {@link defineEval} takes an
 * {@link EvalFile.EvalFile} (the `{ suites, layer, options? }` contract
 * shared with the CLI, see `../EvalFile.ts`) and registers one `describe`
 * per suite, one `it` per case — evalite-style, so an eval run's results
 * render as familiar test output under `vp test run`. Only this sub-export
 * imports `vite-plus/test`; the core barrel (`.`) never does, so this
 * package's eventual extraction into its own repository sheds `./viteplus`
 * without touching anything else — see
 * `docs/decisions/effect-evals-as-the-evaluation-toolkit.md` and the
 * `./viteplus` amendment in `docs/decisions/single-barrel-package-exports.md`.
 *
 * **Credential gating.** `evalFile.layer` is built exactly once, shared
 * across every suite in the file (see {@link evaluateEvalFile}) rather than
 * rebuilt per suite. If that build fails with a `Config.ConfigError` when a
 * required provider credential (e.g. `CF_AIG_TOKEN`) is unset, every suite
 * SKIPS — one `it` calling `ctx.skip(message)` per suite, naming the missing
 * config — rather than failing, so an eval file is safe to sit in the tree
 * while `vp run test:unit` runs credential-less. A suite's own
 * dataset/task/metric bug only fails that suite, surfaced as one failing
 * `it`; it can't sabotage its siblings.
 *
 * @module viteplus
 */

import { describe, it } from "vite-plus/test";
import type { TestContext } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as EvalFile from "../EvalFile";
import type * as Result from "../Result";
import * as Runner from "../Runner";
import * as Threshold from "../Threshold";

// ── Suite execution ──────────────────────────────────────────────────

/** The outcome of running one suite through {@link evaluateEvalFile} / {@link evaluateSuite}. */
export type SuiteOutcome =
  | { readonly _tag: "Skipped"; readonly suite: string; readonly message: string }
  | { readonly _tag: "Errored"; readonly suite: string; readonly message: string }
  | { readonly _tag: "Ran"; readonly suite: string; readonly result: Result.SuiteResult };

const isConfigError = (error: unknown): error is Config.ConfigError =>
  error instanceof Config.ConfigError;

/**
 * The first `Config.ConfigError` anywhere among a cause's (flat, per this
 * effect version's `Cause`) failure reasons — not just the first reason
 * overall, so a `ConfigError` racing another failure (e.g. the layer build
 * and a suite's own dataset load both failing) is still found rather than
 * silently misclassified as a plain `Errored`.
 */
const configErrorIn = (cause: Cause.Cause<unknown>): Config.ConfigError | undefined => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason) && isConfigError(reason.error)) return reason.error;
  }
  return undefined;
};

/**
 * Runs every suite in `evalFile`, providing `evalFile.layer` exactly
 * once — shared across every suite's run, not rebuilt per suite — around
 * all of them running concurrently. Each suite's own dataset/task/metric
 * failure is captured via its own `Effect.exit` *inside* that shared
 * context, so one suite's bug can't sabotage its siblings. If `layer`
 * itself fails to build with a `Config.ConfigError` (e.g. `CF_AIG_TOKEN`
 * unset), every suite in the file comes back `Skipped`, naming the missing
 * config — the credential-gating semantic this adapter promises. Any other
 * layer failure marks every suite `Errored`. Never rejects.
 */
export const evaluateEvalFile = (
  evalFile: EvalFile.EvalFile<any, any>,
): Effect.Effect<ReadonlyArray<SuiteOutcome>> =>
  Effect.gen(function* () {
    const outerExit = yield* Effect.exit(
      Effect.forEach(
        evalFile.suites,
        (suite) =>
          Effect.exit(Runner.runSuite(suite, evalFile.options)).pipe(
            Effect.map(
              (exit): SuiteOutcome =>
                Exit.isSuccess(exit)
                  ? { _tag: "Ran" as const, suite: suite.name, result: exit.value }
                  : {
                      _tag: "Errored" as const,
                      suite: suite.name,
                      message: Cause.pretty(exit.cause),
                    },
            ),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.provide(evalFile.layer)),
    );

    if (Exit.isSuccess(outerExit)) return outerExit.value;

    const configError = configErrorIn(outerExit.cause);
    return evalFile.suites.map(
      (suite): SuiteOutcome =>
        configError !== undefined
          ? {
              _tag: "Skipped" as const,
              suite: suite.name,
              message: `missing configuration — ${configError.message}`,
            }
          : { _tag: "Errored" as const, suite: suite.name, message: Cause.pretty(outerExit.cause) },
    );
  });

/** {@link evaluateEvalFile} for a single suite — a convenience for testing or running one suite in isolation. */
export const evaluateSuite = (
  evalFile: EvalFile.EvalFile<any, any>,
  suite: EvalFile.AnySuite,
): Effect.Effect<SuiteOutcome> =>
  Effect.map(evaluateEvalFile({ ...evalFile, suites: [suite] }), (outcomes) => outcomes[0]!);

// ── Failure message formatting ───────────────────────────────────────

/** The most recent scored trial's reason, or the most recent errored trial's error, for a failure message. */
const formatMetricReason = (metric: Result.MetricAggregate): string => {
  for (let i = metric.trials.length - 1; i >= 0; i--) {
    const trial = metric.trials[i];
    if (trial?._tag === "Scored") return trial.score.reason ?? "(no reason given)";
  }
  for (let i = metric.trials.length - 1; i >= 0; i--) {
    const trial = metric.trials[i];
    if (trial?._tag === "Errored") return `error: ${String(trial.error)}`;
  }
  return "(no trials recorded)";
};

const formatSpread = (summary: Result.Summary | undefined): string =>
  summary === undefined
    ? "no scored trials"
    : `mean=${summary.mean.toFixed(3)} stddev=${summary.stddev.toFixed(3)} [${summary.min.toFixed(3)}, ${summary.max.toFixed(3)}]`;

/**
 * Builds a failing case's assertion message: any task-trial failures, then
 * every failing metric's name, score-vs-threshold, judge reason, and trial
 * spread.
 */
export const formatCaseFailure = (
  caseResult: Result.CaseResult,
  suite: EvalFile.AnySuite,
): string => {
  const lines: Array<string> = [];

  for (const taskFailure of caseResult.taskFailures) {
    lines.push(`task failed on trial ${taskFailure.trial}: ${String(taskFailure.error)}`);
  }

  for (const metric of caseResult.metrics) {
    if (metric.passed) continue;
    const threshold = suite.metrics.find(
      (candidate) => candidate.name === metric.metric,
    )?.threshold;
    const errorSuffix =
      metric.errorCount > 0
        ? ` (${metric.errorCount} errored trial${metric.errorCount === 1 ? "" : "s"})`
        : "";
    lines.push(
      `metric "${metric.metric}" failed — score ${formatSpread(metric.summary)} vs threshold ${
        threshold ? Threshold.describe(threshold) : "?"
      }${errorSuffix}; reason: ${formatMetricReason(metric)}`,
    );
  }

  if (lines.length === 0) {
    lines.push("case failed with no recorded task failures or failing metrics");
  }

  return lines.join("\n");
};

/** A short, stable label for a case's `it` block: the golden's `input` when present, else its index. */
export const caseLabel = (golden: unknown, index: number): string => {
  const input =
    golden !== null && typeof golden === "object" && "input" in golden
      ? (golden as { readonly input: unknown }).input
      : undefined;
  if (typeof input !== "string") return `case ${index}`;
  return input.length > 60 ? `[${index}] ${input.slice(0, 57)}...` : `[${index}] ${input}`;
};

// ── Registration ──────────────────────────────────────────────────────

const registerSuite = (
  suite: EvalFile.AnySuite,
  outcomes: Promise<ReadonlyArray<SuiteOutcome>>,
  index: number,
): void => {
  describe(suite.name, async () => {
    const resolved = (await outcomes)[index]!;

    if (resolved._tag === "Skipped") {
      it(suite.name, (ctx: TestContext) => {
        ctx.skip(resolved.message);
      });
      return;
    }

    if (resolved._tag === "Errored") {
      it(suite.name, () => {
        throw new Error(`suite "${suite.name}" failed to run:\n${resolved.message}`);
      });
      return;
    }

    if (resolved.result.cases.length === 0) {
      it(suite.name, () => {
        throw new Error(
          `suite "${suite.name}" produced zero cases — its dataset returned an empty array`,
        );
      });
      return;
    }

    for (const [caseIndex, caseResult] of resolved.result.cases.entries()) {
      it(caseLabel(caseResult.golden, caseIndex), () => {
        if (!caseResult.passed) {
          throw new Error(formatCaseFailure(caseResult, suite));
        }
      });
    }
  });
};

/**
 * Registers every suite in `evalFile` with `vite-plus/test`: one `describe`
 * per suite, one `it` per case (skipped on missing config, failing with
 * metric name / score vs threshold / judge reason / trial spread on a
 * missed threshold; a suite whose dataset comes back empty fails loudly
 * rather than silently registering zero tests). Returns `evalFile` unchanged
 * so an `*.eval.ts` file can both register its tests and satisfy the
 * `EvalFile` default-export contract in one expression:
 *
 * ```ts
 * export default defineEval({ suites: [mySuite], layer: myLayer });
 * ```
 *
 * Two things happen only when actually running under `vite-plus/test`
 * (`process.env.VITEST === "true"`, set by its CLI before test files load):
 * outside that — e.g. a future CLI (#930) dynamically `import()`ing this
 * same file to read its plain `EvalFile` shape — `defineEval` is a no-op
 * identity function. `describe`/`it` throw immediately when called with no
 * active vitest run (verified: `Cannot read properties of undefined
 * (reading 'config')`, the same failure `tests/helpers/effect.ts` documents
 * for `@effect/vitest`), and eagerly running every suite as an *import* side
 * effect would be wrong even if it didn't throw — a CLI that just wants the
 * suite/layer definitions shouldn't pay for (or trigger) a real run of them.
 *
 * Every suite starts running as soon as this is called, concurrently and
 * sharing one build of `evalFile.layer` (see {@link evaluateEvalFile}): the
 * single `Effect.runPromise` below kicks off immediately, before any
 * `describe` is registered. Vitest's collector awaits one top-level
 * `describe`'s async factory before starting the next, so registering first
 * and only then awaiting the already in-flight shared promise (inside
 * `registerSuite`) is what lets N suites' dataset/task/judge calls overlap
 * instead of running one suite to completion before the next begins.
 */
export const defineEval = <R = never, E = never>(
  evalFile: EvalFile.EvalFile<R, E>,
): EvalFile.EvalFile<R, E> => {
  if (process.env.VITEST !== "true") return evalFile;

  const outcomes = Effect.runPromise(evaluateEvalFile(evalFile));
  evalFile.suites.forEach((suite, index) => registerSuite(suite, outcomes, index));

  return evalFile;
};
