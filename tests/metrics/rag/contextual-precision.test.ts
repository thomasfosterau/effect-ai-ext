/**
 * Unit tests for `ContextualPrecision.contextualPrecision`: the
 * `weightedCumulativePrecision` pure function against a hand-computed
 * fixture, and the metric's classify-only wiring (no extraction step, since
 * the ranked `retrievedContext` chunks are already the atomic units).
 *
 * @module tests/metrics/rag/contextual-precision
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  ContextualPrecision,
  EvalCase,
  ExtractThenClassify,
  GEval,
  Golden,
  Metric,
  Threshold,
} from "@thomasfosterau/effect-evals";
import { expectFailureInstanceOf, runTest } from "@test-helpers/effect";
import { deadJudge, makeJudgeStub, provideJudge } from "./helpers";

const RagGolden = Golden.Golden(Schema.String, Schema.String);
const RagTestCase = EvalCase.EvalCase(RagGolden, Schema.String);
type RagTestCase = typeof RagTestCase.Type;

describe("ContextualPrecision.weightedCumulativePrecision", () => {
  it("matches a hand-computed fixture: relevant, irrelevant, relevant, irrelevant, relevant", () => {
    // Rank 1 relevant: relevant@1/1 = 1/1 = 1
    // Rank 2 irrelevant: skipped (rₖ = 0)
    // Rank 3 relevant: relevant@3/3 = 2/3
    // Rank 4 irrelevant: skipped
    // Rank 5 relevant: relevant@5/5 = 3/5
    // sum = 1 + 2/3 + 3/5 = 2.26666...; / |relevant| (3) = 0.75555...
    const score = ContextualPrecision.weightedCumulativePrecision([true, false, true, false, true]);
    expect(score).toBeCloseTo(0.7555555556);
  });

  it("scores 1 when every chunk is relevant, regardless of count", () => {
    expect(ContextualPrecision.weightedCumulativePrecision([true])).toBe(1);
    expect(ContextualPrecision.weightedCumulativePrecision([true, true, true])).toBe(1);
  });

  it("scores 0 when nothing is relevant", () => {
    expect(ContextualPrecision.weightedCumulativePrecision([false, false])).toBe(0);
  });

  it("scores 0 for an empty ranking", () => {
    expect(ContextualPrecision.weightedCumulativePrecision([])).toBe(0);
  });

  it("rewards a relevant chunk ranked earlier over the same chunk ranked later", () => {
    const relevantFirst = ContextualPrecision.weightedCumulativePrecision([true, false]);
    const relevantLast = ContextualPrecision.weightedCumulativePrecision([false, true]);
    expect(relevantFirst).toBeGreaterThan(relevantLast);
    expect(relevantFirst).toBe(1);
    expect(relevantLast).toBe(0.5);
  });
});

describe("ContextualPrecision.contextualPrecision", () => {
  const ragCase: RagTestCase = {
    golden: { input: "Where is the Eiffel Tower?", expected: "It is located in Paris, France." },
    output: "Paris.",
    retrievedContext: [
      "The Eiffel Tower is in Paris, France.",
      "The Louvre is also in Paris.",
      "Paris is the capital of France.",
    ],
  };

  it("classifies ranked chunks against expected with no extraction call, then weights by rank", async () => {
    const metric = ContextualPrecision.contextualPrecision({ threshold: Threshold.minScore(0.5) });

    const { model, calls } = await runTest(
      makeJudgeStub([
        () => ({
          verdicts: [
            { statement: "The Eiffel Tower is in Paris, France.", verdict: "yes" },
            {
              statement: "The Louvre is also in Paris.",
              verdict: "no",
              reason: "not about the Eiffel Tower",
            },
            { statement: "Paris is the capital of France.", verdict: "yes" },
          ],
        }),
      ]),
    );

    const result = await runTest(
      Metric.evaluate(metric, ragCase).pipe(Effect.provide(provideJudge(model))),
    );

    // relevance = [true, false, true] -> 1 + 2/3 = 1.6666...; / 2 = 0.8333...
    expect(result.score.score).toBeCloseTo(0.8333333333);
    expect(result.score.reason).toBe(
      "2/3 retrieved chunks relevant.\n- [2] The Louvre is also in Paris.: not about the Eiffel Tower",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.user).toContain("expected:\nIt is located in Paris, France.");
    expect(calls[0]?.user).toContain(
      "retrieved context chunks:\n1. The Eiffel Tower is in Paris, France.",
    );
    expect(calls[0]?.user).toContain("3. Paris is the capital of France.");
  });

  it("fails with the typed count-mismatch error, not a corrupted score, when the judge drops a verdict", async () => {
    const metric = ContextualPrecision.contextualPrecision({ threshold: Threshold.minScore(0.5) });

    // The judge returns only 2 verdicts for 3 chunks — exactly the
    // structured-output flakiness that would otherwise silently misalign
    // `retrievedContext`'s rank order against `weightedCumulativePrecision`.
    const { model } = await runTest(
      makeJudgeStub([
        () => ({
          verdicts: [
            { statement: "The Eiffel Tower is in Paris, France.", verdict: "yes" },
            { statement: "Paris is the capital of France.", verdict: "yes" },
          ],
        }),
      ]),
    );

    const failure = await expectFailureInstanceOf(
      Metric.evaluate(metric, ragCase).pipe(Effect.provide(provideJudge(model)), Effect.asVoid),
      ExtractThenClassify.VerdictCountMismatchError,
    );

    expect(failure.expected).toBe(3);
    expect(failure.actual).toBe(2);
  });

  it("scores 0 without calling the judge when retrievedContext is empty", async () => {
    const metric = ContextualPrecision.contextualPrecision({ threshold: Threshold.minScore(0.5) });
    const emptyContextCase: RagTestCase = {
      golden: { input: "x", expected: "y" },
      output: "z",
      retrievedContext: [],
    };

    const model = await deadJudge();

    const result = await runTest(
      Metric.evaluate(metric, emptyContextCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score).toEqual({
      score: 0,
      reason: "No retrieved context to evaluate.",
      metadata: { verdicts: [] },
    });
  });

  it("fails with the typed error, never calling the judge, when expected is absent", async () => {
    const metric = ContextualPrecision.contextualPrecision({ threshold: Threshold.minScore(0.5) });
    const caseWithoutExpected: RagTestCase = {
      golden: { input: "x" },
      output: "y",
      retrievedContext: ["z"],
    };

    const model = await deadJudge();

    const failure = await expectFailureInstanceOf(
      Metric.evaluate(metric, caseWithoutExpected).pipe(
        Effect.provide(provideJudge(model)),
        Effect.asVoid,
      ),
      GEval.MissingEvaluationParamError,
    );

    expect(failure.param).toBe("expected");
    expect(failure.metric).toBe("contextual-precision");
  });
});
