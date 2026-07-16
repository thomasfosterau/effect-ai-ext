/**
 * @copyright Thomas Foster
 *
 * `Metric` — a {@link Scorer.Scorer} paired with a {@link Threshold.Threshold}
 * policy and a display name, the unit a runner (#924) will actually execute
 * and report on. Scorers stay reusable and threshold-agnostic; a metric is
 * what turns a raw score into a pass/fail verdict for one particular
 * evaluation.
 *
 * @module Metric
 */

import * as Effect from "effect/Effect";
import type { Score } from "./Score";
import type { Scorer } from "./Scorer";
import { passes, type Threshold } from "./Threshold";

/** The outcome of evaluating one {@link Metric} against one case. */
export interface MetricResult {
  readonly score: Score;
  readonly passed: boolean;
}

/** A named scorer plus the threshold policy that turns its score into a verdict. */
export interface Metric<in Case, out E = never, out R = never> {
  readonly name: string;
  readonly scorer: Scorer<Case, E, R>;
  readonly threshold: Threshold;
}

/** Constructs a {@link Metric} from a display name, scorer, and threshold policy. */
export const makeMetric = <Case, E = never, R = never>(options: {
  readonly name: string;
  readonly scorer: Scorer<Case, E, R>;
  readonly threshold: Threshold;
}): Metric<Case, E, R> => options;

/** Runs a metric's scorer against a case and applies its threshold policy to the result. */
export const evaluate = <Case, E, R>(
  metric: Metric<Case, E, R>,
  evalCase: Case,
): Effect.Effect<MetricResult, E, R> =>
  Effect.map(metric.scorer.evaluate(evalCase), (score) => ({
    score,
    passed: passes(metric.threshold, score.score),
  }));
