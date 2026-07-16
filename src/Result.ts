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

import type { Score } from "./Score";

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
