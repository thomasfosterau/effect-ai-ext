/**
 * Unit tests for the ranking metrics (`src/metrics/Ranking.ts`).
 *
 * These are the numbers every retrieval suite is downstream of, so they
 * are pinned against **hand-computed** expectations rather than against
 * what the implementation happens to produce: an assertion written by
 * running the code and pasting the output proves only that the code is
 * deterministic. The fixtures are gardeneria's `packages/evaluation`
 * `metrics.test.ts`, the behavioural spec this module was ported from.
 *
 * @module tests/metrics/ranking
 */

import { describe, expect, it } from "vitest";
import { Metric, Ranking, Threshold } from "../../src/index.ts";
import { runTest } from "../helpers/effect.ts";

/** Two relevant documents, graded 3 and 1, in a five-document corpus. */
const evidence = (ranked: ReadonlyArray<string>, k = 5): Ranking.Evidence => ({
  ranked,
  relevant: { a: 3, b: 1 },
  k,
});

describe("Ranking.ndcg", () => {
  it("scores the ideal ordering 1", () => {
    expect(Ranking.ndcg(evidence(["a", "b", "x", "y", "z"]))).toBe(1);
  });

  it("scores a ranking with no relevant document 0", () => {
    expect(Ranking.ndcg(evidence(["x", "y", "z"]))).toBe(0);
  });

  it("uses exponential gain, so one grade-3 hit beats several grade-1 hits", () => {
    // gain(3) = 2^3 - 1 = 7; gain(1) = 1. Under LINEAR gain three 1s (3)
    // would beat one 3 — which is the reading this metric deliberately
    // rejects, so the assertion is about the formulation, not the numbers.
    const oneStrong = Ranking.ndcg({ ranked: ["a"], relevant: { a: 3, p: 1, q: 1, r: 1 }, k: 4 });
    const threeWeak = Ranking.ndcg({
      ranked: ["p", "q", "r"],
      relevant: { a: 3, p: 1, q: 1, r: 1 },
      k: 4,
    });
    expect(oneStrong).toBeGreaterThan(threeWeak);
  });

  it("discounts by log2(rank + 1)", () => {
    // Swapped: `b` (gain 1) at rank 1, `a` (gain 7) at rank 2.
    //   DCG  = 1/log2(2) + 7/log2(3) = 1 + 4.41650… = 5.41650…
    //   IDCG = 7/log2(2) + 1/log2(3) = 7 + 0.63092… = 7.63092…
    expect(Ranking.ndcg(evidence(["b", "a"]))).toBeCloseTo(5.4165 / 7.63093, 5);
  });

  it("normalises against the case's own relevant set, not a full page of grade-3s", () => {
    // Two relevant documents and a page of twenty: a perfect ranking still
    // scores 1. Normalising against twenty imaginary 3s would cap it near
    // 0.1 and make cases incomparable to one another.
    expect(Ranking.ndcg(evidence(["a", "b", "x"], 20))).toBe(1);
  });

  it("ignores anything past the cutoff", () => {
    expect(Ranking.ndcg(evidence(["x", "y", "a", "b"], 2))).toBe(0);
  });

  it("scores 0 rather than NaN when the relevance map is empty", () => {
    expect(Ranking.ndcg({ ranked: ["a"], relevant: {}, k: 5 })).toBe(0);
  });
});

describe("Ranking.recall", () => {
  it("is the fraction of the relevant set inside the cutoff, order-blind", () => {
    expect(Ranking.recall(evidence(["b", "a"]))).toBe(1);
    expect(Ranking.recall(evidence(["a", "x"]))).toBe(0.5);
    expect(Ranking.recall(evidence(["x", "y"]))).toBe(0);
  });

  it("drops a relevant document that fell past the cutoff", () => {
    expect(Ranking.recall(evidence(["a", "x", "b"], 2))).toBe(0.5);
  });

  it("scores 0 rather than NaN when the relevance map is empty", () => {
    expect(Ranking.recall({ ranked: ["a"], relevant: {}, k: 5 })).toBe(0);
  });
});

describe("Ranking.precision", () => {
  it("divides by k, not by how many rows came back", () => {
    // Three returned, all three graded: still 3/5, because a page that
    // under-fills has not served the user as well as a full one.
    expect(
      Ranking.precision({ ranked: ["a", "b", "c"], relevant: { a: 3, b: 2, c: 1 }, k: 5 }),
    ).toBe(0.6);
  });

  it("is 0 at a zero cutoff rather than dividing by zero", () => {
    expect(Ranking.precision(evidence(["a"], 0))).toBe(0);
  });
});

describe("Ranking.mrr", () => {
  it("is the reciprocal of the first relevant rank", () => {
    expect(Ranking.mrr(evidence(["a", "b"]))).toBe(1);
    expect(Ranking.mrr(evidence(["x", "a"]))).toBe(0.5);
    expect(Ranking.mrr(evidence(["x", "y", "b"]))).toBeCloseTo(1 / 3, 10);
  });

  it("is 0 when the first relevant document is past the cutoff", () => {
    expect(Ranking.mrr(evidence(["x", "y", "a"], 2))).toBe(0);
  });
});

describe("Ranking.scoreCase", () => {
  it("keys every score by metric and cutoff, so two page sizes never share a column", () => {
    expect(Object.keys(Ranking.scoreCase(evidence(["a", "b"], 10))).sort()).toEqual([
      "mrr@10",
      "ndcg@10",
      "precision@10",
      "recall@10",
    ]);
    expect(Ranking.metricKey("ndcg", 20)).toBe("ndcg@20");
  });

  it("scores only the metrics it was given", () => {
    expect(Ranking.scoreCase(evidence(["a"]), ["recall"])).toEqual({ "recall@5": 0.5 });
  });
});

describe("Ranking scorers", () => {
  const rankingCase = (output: ReadonlyArray<string>): Ranking.RankingCase => ({
    golden: { relevant: { a: 3, b: 1 } },
    output,
  });

  it("names each scorer by its metric key", () => {
    expect(Ranking.ndcgAtK(10).name).toBe("ndcg@10");
    expect(Ranking.recallAtK(10).name).toBe("recall@10");
    expect(Ranking.mrrAtK(10).name).toBe("mrr@10");
    expect(Ranking.precisionAtK(10).name).toBe("precision@10");
  });

  it("scores a RankingCase exactly as the pure function does, with a reason", async () => {
    const score = await runTest(Ranking.ndcgAtK(5).evaluate(rankingCase(["b", "a"])));
    expect(score.score).toBeCloseTo(5.4165 / 7.63093, 5);
    expect(score.reason).toBe("2 of 2 relevant in the top 5; nDCG 0.710");

    const recall = await runTest(Ranking.recallAtK(2).evaluate(rankingCase(["a", "x", "b"])));
    expect(recall).toEqual({ score: 0.5, reason: "1 of 2 relevant reached the top 2" });

    const precision = await runTest(Ranking.precisionAtK(5).evaluate(rankingCase(["a", "b", "c"])));
    expect(precision).toEqual({ score: 0.4, reason: "2 of the top 5 are relevant" });

    const mrr = await runTest(Ranking.mrrAtK(5).evaluate(rankingCase(["x", "a"])));
    expect(mrr).toEqual({ score: 0.5, reason: "first relevant document at rank 2" });

    const miss = await runTest(Ranking.mrrAtK(2).evaluate(rankingCase(["x", "y", "a"])));
    expect(miss).toEqual({ score: 0, reason: "no relevant document in the top 2" });
  });

  it("re-applies k itself rather than trusting the output's length", async () => {
    const score = await runTest(Ranking.recallAtK(1).evaluate(rankingCase(["x", "a", "b"])));
    expect(score.score).toBe(0);
  });

  it("builds metrics that never fail a case unless a threshold is given", async () => {
    const lenient = Ranking.metricAtK("recall", 5);
    expect(lenient.name).toBe("recall@5");
    const miss = await runTest(Metric.evaluate(lenient, rankingCase(["x"])));
    expect(miss).toEqual({ score: { score: 0, reason: "0 of 2 relevant reached the top 5" }, passed: true });

    const strict = Ranking.metricAtK("recall", 5, Threshold.minScore(0.75));
    const half = await runTest(Metric.evaluate(strict, rankingCase(["a", "x"])));
    expect(half.passed).toBe(false);
  });

  it("metricsAtK builds every metric in report order, threading per-metric thresholds", () => {
    const metrics = Ranking.metricsAtK(10, { thresholds: { ndcg: Threshold.minScore(0.8) } });
    expect(metrics.map((metric) => metric.name)).toEqual([
      "ndcg@10",
      "recall@10",
      "mrr@10",
      "precision@10",
    ]);
    expect(metrics[0]?.threshold).toEqual(Threshold.minScore(0.8));
    expect(metrics[1]?.threshold).toEqual(Threshold.minScore(0));

    expect(
      Ranking.metricsAtK(3, { metrics: ["recall", "ndcg"] }).map((metric) => metric.name),
    ).toEqual(["recall@3", "ndcg@3"]);
  });
});
