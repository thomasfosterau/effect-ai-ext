/**
 * Unit tests for `ContextualRecall.contextualRecall`: extracts statements
 * from `expected`, classifies each against `retrievedContext`, scores the
 * fraction attributable.
 *
 * @module tests/metrics/rag/contextual-recall
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  ContextualRecall,
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
  golden: {
    input: "Where is the Eiffel Tower?",
    expected: "It is in Paris, on the Champ de Mars.",
  },
  output: "It is in Paris.",
  retrievedContext: ["The Eiffel Tower is located in Paris, France."],
};

describe("ContextualRecall.contextualRecall", () => {
  it("scores the fraction of expected statements attributable to retrievedContext", async () => {
    const metric = ContextualRecall.contextualRecall({ threshold: Threshold.minScore(0.5) });

    const { model, calls } = await runTest(
      makeJudgeStub([
        () => ({ statements: ["It is in Paris.", "It is on the Champ de Mars."] }),
        () => ({
          verdicts: [
            { statement: "It is in Paris.", verdict: "yes" },
            {
              statement: "It is on the Champ de Mars.",
              verdict: "no",
              reason: "not mentioned in context",
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
      "1/2 statements passed.\n- It is on the Champ de Mars.: not mentioned in context",
    );
    expect(calls[0]?.user).toContain("expected:\nIt is in Paris, on the Champ de Mars.");
    expect(calls[1]?.user).toContain(
      "retrievedContext:\n[1] The Eiffel Tower is located in Paris, France.",
    );
  });

  it("fails with the typed error, never calling the judge, when expected is absent", async () => {
    const metric = ContextualRecall.contextualRecall({ threshold: Threshold.minScore(0.5) });
    const caseWithoutExpected: RagTestCase = {
      golden: { input: "x" },
      output: "y",
      retrievedContext: ["z"],
    };

    const model = await deadJudge();

    const failure = (await expectFailureInstanceOf(
      Metric.evaluate(metric, caseWithoutExpected).pipe(
        Effect.provide(provideJudge(model)),
        Effect.asVoid,
      ),
      GEval.MissingEvaluationParamError,
    )) as GEval.MissingEvaluationParamError;

    expect(failure.param).toBe("expected");
    expect(failure.metric).toBe("contextual-recall");
  });
});
