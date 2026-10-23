/**
 * The typed result model a {@link Runner.runSuite} run produces: suite →
 * case → trial → metric result. A metric *execution error* (the scorer's
 * Effect failed) is kept distinct from a *failing score* (the scorer
 * succeeded but the score missed its threshold) — DeepEval's
 * `ignore_errors` semantics. This module carries only the data shape and
 * pure statistics; {@link Runner} decides what counts as a pass.
 *
 * @module Result
 *
 * @copyright Thomas Foster
 */

import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as EffectRecord from "effect/Record";
import type { Score } from "./Score.ts";

/** One trial's outcome for a metric: a score, or the scorer's Effect failed. */
export type MetricTrialOutcome =
  | {
      readonly _tag: "Scored";
      readonly trial: number;
      readonly score: Score;
      readonly cached: boolean;
    }
  | {
      readonly _tag: "Errored";
      readonly trial: number;
      readonly error: unknown;
      readonly cached: boolean;
    };

/** Mean, population spread (variance/stddev), and range over a metric's per-trial scores. */
export interface Summary {
  readonly mean: number;
  readonly variance: number;
  readonly stddev: number;
  readonly min: number;
  readonly max: number;
}

/** Computes {@link Summary} statistics for a non-empty array of `0..1` scores. */
export const summarize = (scores: ReadonlyArray<number>): Summary => {
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
  return {
    mean,
    variance,
    stddev: Math.sqrt(variance),
    min: Math.min(...scores),
    max: Math.max(...scores),
  };
};

/** One metric's aggregated result across every trial run for a case. */
export interface MetricAggregate {
  readonly metric: string;
  readonly trials: ReadonlyArray<MetricTrialOutcome>;
  readonly summary: Summary | undefined;
  readonly errorCount: number;
  readonly passed: boolean;
}

// ── Outcome-explaining / rendering seam ──────────────────────────────
//
// `Reporter.ts` (the single-suite terminal table), a runner adapter (a
// failing case's assertion message), and the CLI (which renders through
// `Reporter.formatTerminalTable`) all need to say *which trial explains a
// metric's outcome* and *how spread out its scores were*. Both pieces of
// logic — and their fallback text for the "nothing to explain" cases — are
// canonical here so every caller renders identically instead of
// re-deriving (and drifting from) its own copy.

const NO_REASON_GIVEN = "(no reason given)";
const NO_TRIALS_RECORDED = "(no trials recorded)";
const NO_SCORED_TRIALS = "no scored trials";

/**
 * The trial that explains a metric's aggregate outcome, display-ready: the
 * most recent `Scored` trial's reason (or a placeholder when the scorer
 * gave none), falling back to the most recent `Errored` trial's error when
 * no trial scored, and a placeholder when there are no trials at all.
 */
export const lastReason = (metric: MetricAggregate): string =>
  Arr.findLast(metric.trials, (trial) =>
    Predicate.isTagged(trial, "Scored")
      ? Option.some(trial.score.reason ?? NO_REASON_GIVEN)
      : Option.none(),
  ).pipe(
    Option.orElse(() =>
      Arr.findLast(metric.trials, (trial) =>
        Predicate.isTagged(trial, "Errored")
          ? Option.some(`error: ${String(trial.error)}`)
          : Option.none(),
      ),
    ),
    Option.getOrElse(() => NO_TRIALS_RECORDED),
  );

/** Renders a {@link Summary} as `mean=… stddev=… [min, max]`, or a placeholder when every trial errored. */
export const formatSpread = (summary: Summary | undefined): string =>
  summary === undefined
    ? NO_SCORED_TRIALS
    : `mean=${summary.mean.toFixed(3)} stddev=${summary.stddev.toFixed(3)} [${summary.min.toFixed(3)}, ${summary.max.toFixed(3)}]`;

/** A task (system-under-test) trial that failed to produce an output. */
export interface TaskTrialFailure {
  readonly trial: number;
  readonly error: unknown;
}

/**
 * A task (system-under-test) trial that produced an output: the output the
 * metrics scored and how long the task took to produce it.
 *
 * `durationMillis` is the task's wall-clock time, retries included. A trial
 * served from the result cache did not run the task, so it is `cached: true`
 * with a `durationMillis` of `0`; leave cached trials out of a latency figure.
 */
export interface TaskTrialOutput<Output = unknown> {
  readonly trial: number;
  readonly output: Output;
  readonly durationMillis: number;
  readonly cached: boolean;
}

/**
 * One golden's aggregated result: its metrics, each trial's task output or
 * task failure, and the overall verdict.
 */
export interface CaseResult<Golden = unknown, Output = unknown> {
  readonly golden: Golden;
  readonly trials: number;
  /** The trials whose task produced an output, in trial order. */
  readonly taskOutputs: ReadonlyArray<TaskTrialOutput<Output>>;
  readonly taskFailures: ReadonlyArray<TaskTrialFailure>;
  readonly metrics: ReadonlyArray<MetricAggregate>;
  readonly passed: boolean;
}

/** A suite's full result: every case, the overall verdict, and wall-clock duration. */
export interface SuiteResult<Golden = unknown, Output = unknown> {
  readonly suite: string;
  readonly cases: ReadonlyArray<CaseResult<Golden, Output>>;
  readonly passed: boolean;
  readonly durationMillis: number;
}

// ── Cross-case aggregation ───────────────────────────────────────────

/** One metric's mean across a suite's cases — see {@link aggregate}. */
export interface MetricAggregateAcrossCases {
  /** Mean of the per-case means, over the cases that scored this metric. */
  readonly mean: number;
  /** How many cases contributed a score. */
  readonly cases: number;
}

/** What {@link aggregate} reduces a suite's cases to. */
export interface Aggregate {
  /** Metric name → mean over the cases that scored it. */
  readonly metrics: Readonly<Record<string, MetricAggregateAcrossCases>>;
  readonly totalCases: number;
  /** Cases in which the task produced an output on at least one trial. */
  readonly successfulCases: number;
  /** Cases in which the task failed on every trial (no output to score). */
  readonly failedCases: number;
}

/**
 * Folds a suite's cases into per-metric means across cases — the number a
 * report compares between two runs of the same dataset.
 *
 * **Means are over the cases that scored only.** A case whose task failed
 * on every trial contributes no evidence about quality, and averaging it in
 * as a zero would report a broken provider as a quality regression; it is
 * counted in `failedCases` instead, where it is visible. Likewise a metric
 * whose every trial errored for a case (no `summary`) is left out of that
 * metric's mean. A suite in which nothing scored aggregates to an empty
 * `metrics` map rather than `NaN`.
 */
export const aggregate = (result: SuiteResult): Aggregate => {
  const successfulCases = Arr.filter(
    result.cases,
    (caseResult) =>
      caseResult.taskFailures.length < caseResult.trials ||
      caseResult.metrics.some((metric) => metric.summary !== undefined),
  ).length;
  const sums = Arr.reduce(
    Arr.flatMap(result.cases, (caseResult) => caseResult.metrics),
    EffectRecord.empty<string, { readonly sum: number; readonly cases: number }>(),
    (acc, metric) => {
      if (metric.summary === undefined) return acc;
      const { mean } = metric.summary;
      return EffectRecord.set(
        acc,
        metric.metric,
        Option.match(EffectRecord.get(acc, metric.metric), {
          onNone: () => ({ sum: mean, cases: 1 }),
          onSome: (entry) => ({ sum: entry.sum + mean, cases: entry.cases + 1 }),
        }),
      );
    },
  );
  const metrics = EffectRecord.map(sums, ({ sum, cases }): MetricAggregateAcrossCases => ({
    mean: sum / cases,
    cases,
  }));
  return {
    metrics,
    totalCases: result.cases.length,
    successfulCases,
    failedCases: result.cases.length - successfulCases,
  };
};
