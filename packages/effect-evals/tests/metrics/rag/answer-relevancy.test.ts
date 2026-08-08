/**
 * Unit tests for `AnswerRelevancy.answerRelevancy`: extracts statements from
 * `output`, classifies each against `input`, scores the fraction relevant.
 *
 * @module tests/metrics/rag/answer-relevancy
 */

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  AnswerRelevancy,
  EvalCase,
  GEval,
  Golden,
  Metric,
  Threshold,
} from "../../../src/index.ts";
import { expectFailureInstanceOf, runTest } from "../../helpers/effect.ts";
import { deadJudge, makeJudgeStub, provideJudge } from "./helpers.ts";

const RagGolden = Golden.Golden(Schema.String, Schema.String);
const RagTestCase = EvalCase.EvalCase(RagGolden, Schema.String);
type RagTestCase = typeof RagTestCase.Type;

const ragCase: RagTestCase = {
  golden: { input: "What is the capital of France?" },
  output: "Paris is the capital of France. Paris also hosted the 1900 Olympics.",
};

describe("AnswerRelevancy.answerRelevancy", () => {
  it("scores the fraction of extracted statements relevant to input", async () => {
    const metric = AnswerRelevancy.answerRelevancy({ threshold: Threshold.minScore(0.5) });

    const { model, calls } = await runTest(
      makeJudgeStub([
        () => ({
          statements: ["Paris is the capital of France.", "Paris hosted the 1900 Olympics."],
        }),
        () => ({
          verdicts: [
            { statement: "Paris is the capital of France.", verdict: "yes" },
            {
              statement: "Paris hosted the 1900 Olympics.",
              verdict: "no",
              reason: "off-topic trivia",
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
      "1/2 statements passed.\n- Paris hosted the 1900 Olympics.: off-topic trivia",
    );
    expect(calls[0]?.user).toContain(
      "output:\nParis is the capital of France. Paris also hosted the 1900 Olympics.",
    );
    expect(calls[1]?.user).toContain("input:\nWhat is the capital of France?");
  });

  it("fails with the typed error, never calling the judge, when output is absent", async () => {
    const metric = AnswerRelevancy.answerRelevancy({ threshold: Threshold.minScore(0.5) });
    const caseWithoutOutput = { golden: { input: "x" } } as unknown as RagTestCase;

    const model = await deadJudge();

    const failure = (await expectFailureInstanceOf(
      Metric.evaluate(metric, caseWithoutOutput).pipe(
        Effect.provide(provideJudge(model)),
        Effect.asVoid,
      ),
      GEval.MissingEvaluationParamError,
    )) as GEval.MissingEvaluationParamError;

    expect(failure.param).toBe("output");
    expect(failure.metric).toBe("answer-relevancy");
  });
});
