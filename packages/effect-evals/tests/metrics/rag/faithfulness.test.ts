/**
 * Unit tests for `Faithfulness.faithfulness`: extracts claims from `output`,
 * classifies each against `retrievedContext`, scores the fraction not
 * contradicted.
 *
 * @module tests/metrics/rag/faithfulness
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { LanguageModel } from "effect/ai";
import {
  EvalCase,
  Faithfulness,
  GEval,
  Golden,
  Metric,
  RagCase,
  Threshold,
} from "../../../src/index.ts";
import { expectFailureInstanceOf, runTest } from "../../helpers/effect.ts";
import { deadJudge, makeJudgeStub, provideJudge } from "./helpers.ts";

const RagGolden = Golden.Golden(Schema.String, Schema.String);
const RagTestCase = EvalCase.EvalCase(RagGolden, Schema.String);
type RagTestCase = typeof RagTestCase.Type;

const ragCase: RagTestCase = {
  golden: { input: "What colour is the sky?" },
  output: "The sky is blue. The sky is also made of cheese.",
  retrievedContext: ["The sky appears blue due to Rayleigh scattering."],
};

describe("Faithfulness.faithfulness", () => {
  it("scores the fraction of extracted claims not contradicted by retrievedContext", async () => {
    const metric: Metric.Metric<RagTestCase, RagCase.RagMetricError, LanguageModel.LanguageModel> =
      Faithfulness.faithfulness({ threshold: Threshold.minScore(0.5) });

    const { model, calls } = await runTest(
      makeJudgeStub([
        () => ({ statements: ["The sky is blue.", "The sky is made of cheese."] }),
        () => ({
          verdicts: [
            { statement: "The sky is blue.", verdict: "yes", reason: "supported by context" },
            {
              statement: "The sky is made of cheese.",
              verdict: "no",
              reason: "contradicted by context",
            },
          ],
        }),
      ]),
    );

    const result = await runTest(
      Metric.evaluate(metric, ragCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score.score).toBe(0.5);
    expect(result.passed).toBe(true);
    expect(result.score.reason).toBe(
      "1/2 statements passed.\n- The sky is made of cheese.: contradicted by context",
    );
    expect(result.score.metadata?.statements).toEqual([
      "The sky is blue.",
      "The sky is made of cheese.",
    ]);
    expect(calls[0]?.user).toContain("output:\nThe sky is blue. The sky is also made of cheese.");
    expect(calls[1]?.user).toContain(
      "retrievedContext:\n[1] The sky appears blue due to Rayleigh scattering.",
    );
  });

  it("fails with the typed error, never calling the judge, when retrievedContext is absent", async () => {
    const metric = Faithfulness.faithfulness({ threshold: Threshold.minScore(0.5) });
    const caseWithoutContext: RagTestCase = { golden: { input: "x" }, output: "y" };

    const model = await deadJudge();

    const failure = (await expectFailureInstanceOf(
      Metric.evaluate(metric, caseWithoutContext).pipe(
        Effect.provide(provideJudge(model)),
        Effect.asVoid,
      ),
      GEval.MissingEvaluationParamError,
    )) as GEval.MissingEvaluationParamError;

    expect(failure.param).toBe("retrievedContext");
    expect(failure.metric).toBe("faithfulness");
  });

  it("scores 0 without calling the judge when retrievedContext is empty, rather than a vacuous pass", async () => {
    const metric = Faithfulness.faithfulness({ threshold: Threshold.minScore(0.5) });
    const caseWithEmptyContext: RagTestCase = {
      golden: { input: "x" },
      output: "The sky is made of cheese.",
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
