/**
 * @copyright Thomas Foster
 *
 * The typed result model a {@link Runner.runSuite} run produces: suite →
 * case → trial → metric result. A metric *execution error* (the scorer's
 * Effect failed) is kept distinct from a *failing score* (the scorer
 * succeeded but the score missed its threshold) — DeepEval's
 * `ignore_errors` semantics. This module carries only the data shape and
 * pure statistics; {@link Runner} decides what counts as a pass.
 *
 * @module Result
 */

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
export const lastReason = (metric: MetricAggregate): string => {
  for (let i = metric.trials.length - 1; i >= 0; i--) {
    const trial = metric.trials[i];
    if (trial?._tag === "Scored") return trial.score.reason ?? NO_REASON_GIVEN;
  }
  for (let i = metric.trials.length - 1; i >= 0; i--) {
    const trial = metric.trials[i];
    if (trial?._tag === "Errored") return `error: ${String(trial.error)}`;
  }
  return NO_TRIALS_RECORDED;
};

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

/** One golden's aggregated result: its metrics, any task failures, and the overall verdict. */
export interface CaseResult<Golden = unknown> {
  readonly golden: Golden;
  readonly trials: number;
  readonly taskFailures: ReadonlyArray<TaskTrialFailure>;
  readonly metrics: ReadonlyArray<MetricAggregate>;
  readonly passed: boolean;
}

/** A suite's full result: every case, the overall verdict, and wall-clock duration. */
export interface SuiteResult<Golden = unknown> {
  readonly suite: string;
  readonly cases: ReadonlyArray<CaseResult<Golden>>;
  readonly passed: boolean;
  readonly durationMillis: number;
}
