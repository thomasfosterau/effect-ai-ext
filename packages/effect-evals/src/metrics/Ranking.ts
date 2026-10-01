/**
 * Ranking metrics for retrieval evaluation — nDCG@k, recall@k, MRR@k and
 * precision@k — as deterministic, judge-free {@link Scorer.Scorer}s over a
 * {@link RankingCase}: the ranked handles a retrieval returned, scored
 * against the golden's graded relevance map. Ported from gardeneria's
 * `packages/evaluation/src/metrics.ts`, whose hand-computed tests are the
 * fixture.
 *
 * ## Why graded relevance, not binary
 *
 * Every metric here reads a grade (`1`–`3` by convention) rather than a
 * yes/no. Binary relevance cannot tell "the right genus, wrong species"
 * from "a cactus", and that is exactly the distinction a reranker change
 * moves: a reranker rarely drops the answer off the page, it demotes it
 * three places and promotes a near-miss. A binary metric scores that
 * change zero. A handle absent from the map is non-relevant (grade `0`);
 * there is no explicit zero, because writing thousands of zeros is how a
 * ground-truth file stops being maintained.
 *
 * ## Why four metrics and not one
 *
 * They fail differently, and the difference is the diagnosis:
 *
 * - **nDCG@k** is the headline — order-sensitive and grade-sensitive.
 * - **recall@k** ignores order entirely, so nDCG down with recall flat
 *   means the *ranking* regressed (fusion weights, the reranker) while
 *   nDCG and recall down together means *retrieval* regressed (a branch
 *   stopped matching, the index went stale).
 * - **MRR@k** is what a user actually feels: how far down the first useful
 *   answer is.
 * - **precision@k** catches a page padded with plausible noise, which the
 *   other three tolerate as long as the good rows are near the top.
 *
 * The cutoff `k` is part of every metric's name (`ndcg@10`, not `ndcg`):
 * `ndcg@10` and `ndcg@20` over the same dataset are different numbers, and
 * a report that put them in one column would show a page-size change as a
 * quality change. Every scorer re-applies `k` itself rather than trusting
 * the ranked list's length — a retrieval that over-returns must not
 * silently inflate recall.
 *
 * @module metrics/Ranking
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import { makeMetric, type Metric } from "../Metric.ts";
import type { Score } from "../Score.ts";
import { makeScorer, type Scorer } from "../Scorer.ts";
import { minScore, type Threshold } from "../Threshold.ts";

/**
 * A document's relevance to a query, keyed by the document's handle.
 * Positive grades are relevant, larger is better; a handle absent from the
 * map is non-relevant. The conventional scale is `1`–`3` (`3` — this is
 * the answer; `2` — a user would be satisfied; `1` — related, better than
 * nothing on the page).
 */
export type GradedRelevance = Readonly<Record<string, number>>;

/**
 * The structural case shape every ranking scorer reads from — matches
 * `Runner.EvaluatedCase<Golden, ReadonlyArray<string>>` for any golden that
 * carries a `relevant` map (such as {@link Runner.RetrievalGolden}), which
 * is what {@link Runner.runRetrievalSuite} produces.
 */
export interface RankingCase {
  readonly golden: {
    /** Handle → grade; see {@link GradedRelevance}. */
    readonly relevant: GradedRelevance;
  };
  /** Document handles the retrieval returned, best first. */
  readonly output: ReadonlyArray<string>;
}

/**
 * The evidence one metric scores, in its pure form: the ordered handles,
 * the graded ground truth, and the cutoff.
 */
export interface Evidence {
  /** Document handles, best first. */
  readonly ranked: ReadonlyArray<string>;
  /** Handle → grade. A handle absent from this map is non-relevant. */
  readonly relevant: GradedRelevance;
  /** Rank cutoff. */
  readonly k: number;
}

/** The built-in ranking metrics, by name. */
export type RankingMetricName = "ndcg" | "recall" | "mrr" | "precision";

/** Every ranking metric this module knows, in the order a report reads best. */
export const ALL_METRICS: ReadonlyArray<RankingMetricName> = ["ndcg", "recall", "mrr", "precision"];

/**
 * The name a score is reported and compared under. The cutoff is part of
 * the name because it is part of the measurement.
 */
export const metricKey = (metric: RankingMetricName, k: number): string => `${metric}@${k}`;

/** The grade of a handle, `0` for one the dataset did not grade. */
const gradeOf = (evidence: Evidence, handle: string): number => evidence.relevant[handle] ?? 0;

/** The top-k slice, guarding against a retrieval that returned more than it was asked for. */
const topK = (evidence: Evidence): ReadonlyArray<string> => evidence.ranked.slice(0, evidence.k);

/**
 * Discounted cumulative gain over an already-ordered grade sequence.
 *
 * Exponential gain (`2^grade - 1`, the Burges formulation) rather than the
 * linear `grade`: linear gain makes three grade-1 hits worth exactly one
 * grade-3 hit, which is not what a user means by a good first result — one
 * exactly-right answer beats three near-misses. The `log2(rank + 1)`
 * discount is the standard one, so a #1 hit is undiscounted and #2 is
 * worth ~63% of it.
 */
const dcg = (grades: ReadonlyArray<number>): number =>
  grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);

/**
 * Normalised DCG at k — the headline number.
 *
 * The ideal ranking is the case's own graded set sorted by grade descending
 * and truncated to k, so a case with two relevant documents and `k = 20`
 * can still score `1`. Normalising against a full page of imaginary
 * grade-3s instead would cap every realistic case well below 1 and make
 * cases incomparable to each other. A case with no relevant document
 * scores `0` rather than dividing by zero.
 */
export const ndcg = (evidence: Evidence): number => {
  const actual = dcg(topK(evidence).map((handle) => gradeOf(evidence, handle)));
  const ideal = dcg(
    Object.values(evidence.relevant)
      .filter((grade) => grade > 0)
      .sort((left, right) => right - left)
      .slice(0, evidence.k),
  );
  return ideal === 0 ? 0 : actual / ideal;
};

/**
 * Fraction of the case's relevant documents that reached the top k, order
 * ignored. The retrieval-side half of the diagnosis above. `0` for a case
 * with no relevant document.
 */
export const recall = (evidence: Evidence): number => {
  const total = Object.values(evidence.relevant).filter((grade) => grade > 0).length;
  if (total === 0) return 0;
  const found = topK(evidence).filter((handle) => gradeOf(evidence, handle) > 0).length;
  return found / total;
};

/**
 * Fraction of the top k that is relevant.
 *
 * Divided by `k` rather than by how many rows came back: a page that
 * returned three rows and got all three right has not served the user as
 * well as one that returned ten and got ten right, and dividing by the
 * short length would score both `1`. `0` at a zero cutoff rather than
 * dividing by zero.
 */
export const precision = (evidence: Evidence): number => {
  if (evidence.k <= 0) return 0;
  return topK(evidence).filter((handle) => gradeOf(evidence, handle) > 0).length / evidence.k;
};

/**
 * Reciprocal of the rank of the first relevant document within the top k,
 * or `0` when none reached it. Bounded by `k` like the others — the page
 * is what the user sees, so an answer at rank 400 is not "worth 1/400", it
 * is worth nothing.
 */
export const mrr = (evidence: Evidence): number => {
  const position = topK(evidence).findIndex((handle) => gradeOf(evidence, handle) > 0);
  return position === -1 ? 0 : 1 / (position + 1);
};

/** The pure metric functions by name — so a suite can name its metrics as data. */
export const metricFunctions: Readonly<Record<RankingMetricName, (evidence: Evidence) => number>> =
  {
    ndcg,
    recall,
    mrr,
    precision,
  };

/** Scores one case against every named metric at once, keyed by {@link metricKey}. */
export const scoreCase = (
  evidence: Evidence,
  metrics: ReadonlyArray<RankingMetricName> = ALL_METRICS,
): Record<string, number> => {
  const scores: Record<string, number> = {};
  for (const metric of metrics) {
    scores[metricKey(metric, evidence.k)] = metricFunctions[metric](evidence);
  }
  return scores;
};

/** The one-line diagnostic a ranking score carries as its `reason`. */
const describe = (metric: RankingMetricName, evidence: Evidence, value: number): string => {
  const page = topK(evidence);
  const relevantOnPage = page.filter((handle) => gradeOf(evidence, handle) > 0).length;
  const relevantTotal = Object.values(evidence.relevant).filter((grade) => grade > 0).length;
  const first = page.findIndex((handle) => gradeOf(evidence, handle) > 0);
  switch (metric) {
    case "ndcg":
      return `${relevantOnPage} of ${relevantTotal} relevant in the top ${evidence.k}; nDCG ${value.toFixed(3)}`;
    case "recall":
      return `${relevantOnPage} of ${relevantTotal} relevant reached the top ${evidence.k}`;
    case "precision":
      return `${relevantOnPage} of the top ${evidence.k} are relevant`;
    case "mrr":
      return first === -1
        ? `no relevant document in the top ${evidence.k}`
        : `first relevant document at rank ${first + 1}`;
  }
};

/**
 * A ranking metric at a cutoff as a {@link Scorer.Scorer} over
 * {@link RankingCase}, named by {@link metricKey} (`ndcg@10`). Never fails:
 * every input has a defined score.
 */
export const scorerAtK = (metric: RankingMetricName, k: number): Scorer<RankingCase> =>
  makeScorer({
    name: metricKey(metric, k),
    evaluate: (evalCase) =>
      Effect.sync((): Score => {
        const evidence: Evidence = { ranked: evalCase.output, relevant: evalCase.golden.relevant, k };
        const value = metricFunctions[metric](evidence);
        return { score: value, reason: describe(metric, evidence, value) };
      }),
  });

/** {@link scorerAtK} for `"ndcg"`. */
export const ndcgAtK = (k: number): Scorer<RankingCase> => scorerAtK("ndcg", k);

/** {@link scorerAtK} for `"recall"`. */
export const recallAtK = (k: number): Scorer<RankingCase> => scorerAtK("recall", k);

/** {@link scorerAtK} for `"mrr"`. */
export const mrrAtK = (k: number): Scorer<RankingCase> => scorerAtK("mrr", k);

/** {@link scorerAtK} for `"precision"`. */
export const precisionAtK = (k: number): Scorer<RankingCase> => scorerAtK("precision", k);

/**
 * A ranking metric at a cutoff as a {@link Metric.Metric} — the scorer plus
 * a threshold. The default threshold (`minScore(0)`) never fails a case:
 * a ranking suite is usually read as numbers to compare across runs rather
 * than as a pass/fail gate, so the gate is opt-in.
 */
export const metricAtK = (
  metric: RankingMetricName,
  k: number,
  threshold: Threshold = minScore(0),
): Metric<RankingCase> =>
  makeMetric({ name: metricKey(metric, k), scorer: scorerAtK(metric, k), threshold });

/** Options for {@link metricsAtK}. */
export interface MetricsAtKOptions {
  /** Which metrics to include, in report order. Default: {@link ALL_METRICS}. */
  readonly metrics?: ReadonlyArray<RankingMetricName> | undefined;
  /** Per-metric thresholds; a metric without one never fails a case. */
  readonly thresholds?: Partial<Readonly<Record<RankingMetricName, Threshold>>> | undefined;
}

/** Every requested ranking metric at one cutoff, ready for a suite's `metrics`. */
export const metricsAtK = (
  k: number,
  options: MetricsAtKOptions = {},
): ReadonlyArray<Metric<RankingCase>> =>
  (options.metrics ?? ALL_METRICS).map((metric) =>
    metricAtK(metric, k, options.thresholds?.[metric] ?? minScore(0)),
  );
