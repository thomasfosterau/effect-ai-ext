/**
 * Unit tests for `ContextualRelevancy.contextualRelevancy`: extracts
 * statements from `retrievedContext`, classifies each against `input`,
 * scores the fraction relevant. Referenceless — no `expected` required.
 *
 * @module tests/metrics/rag/contextual-relevancy
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  ContextualRelevancy,
  EvalCase,
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

const ragCase: RagTestCase = {
  golden: { input: "What is the capital of France?" },
  output: "Paris.",
  retrievedContext: ["Paris is the capital of France.", "The Eiffel Tower opened in 1889."],
};

describe("ContextualRelevancy.contextualRelevancy", () => {
  it("scores the fraction of retrievedContext statements relevant to input, without needing expected", async () => {
    const metric = ContextualRelevancy.contextualRelevancy({ threshold: Threshold.minScore(0.5) });

    const { model, calls } = await runTest(
      makeJudgeStub([
        () => ({
          statements: ["Paris is the capital of France.", "The Eiffel Tower opened in 1889."],
        }),
        () => ({
          verdicts: [
            { statement: "Paris is the capital of France.", verdict: "yes" },
            {
              statement: "The Eiffel Tower opened in 1889.",
              verdict: "no",
              reason: "unrelated trivia",
            },
          ],
        }),
      ]),
    );

    const result = await runTest(
      Metric.evaluate(metric, ragCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score.score).toBe(0.5);
    expect(result.score.reason).toBe(
      "1/2 statements passed.\n- The Eiffel Tower opened in 1889.: unrelated trivia",
    );
    expect(calls[0]?.user).toContain(
      "retrievedContext:\n[1] Paris is the capital of France.\n[2] The Eiffel Tower opened in 1889.",
    );
    expect(calls[1]?.user).toContain("input:\nWhat is the capital of France?");
  });

  it("fails with the typed error, never calling the judge, when retrievedContext is absent", async () => {
    const metric = ContextualRelevancy.contextualRelevancy({ threshold: Threshold.minScore(0.5) });
    const caseWithoutContext: RagTestCase = { golden: { input: "x" }, output: "y" };

    const model = await deadJudge();

    const failure = await expectFailureInstanceOf(
      Metric.evaluate(metric, caseWithoutContext).pipe(
        Effect.provide(provideJudge(model)),
        Effect.asVoid,
      ),
      GEval.MissingEvaluationParamError,
    );

    expect(failure.param).toBe("retrievedContext");
    expect(failure.metric).toBe("contextual-relevancy");
  });

  it("scores 0 without calling the judge when retrievedContext is empty, rather than a vacuous pass", async () => {
    const metric = ContextualRelevancy.contextualRelevancy({ threshold: Threshold.minScore(0.5) });
    const caseWithEmptyContext: RagTestCase = {
      golden: { input: "x" },
      output: "y",
      retrievedContext: [],
    };

    const model = await deadJudge();

    const result = await runTest(
      Metric.evaluate(metric, caseWithEmptyContext).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score).toEqual({
      score: 0,
      reason: "No retrieved context to evaluate.",
      metadata: { statements: [], verdicts: [] },
    });
  });
});
