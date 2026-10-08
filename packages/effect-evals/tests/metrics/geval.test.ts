/**
 * Unit tests for the G-Eval judge metric (`GEval.gEval` /
 * `GEval.gEvalConversational`): the judge `LanguageModel` is stubbed at the
 * provider seam via `LanguageModel.make` (as in
 * `packages/jobs/tests/translation-service.test.ts`), so these tests exercise
 * the real structured-output decoding path while never reaching a network.
 *
 * Covered: score normalisation against a rubric and without one, rubric band
 * validation, criteria-derived vs. explicit evaluation steps, the
 * missing-evaluation-param typed error, reason propagation, conversational
 * turn rendering, and the default template's rendered prompt text.
 *
 * @module tests/metrics/geval
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { LanguageModel } from "effect/ai";
import * as Prompt from "effect/ai/Prompt";
import { EvalCase, GEval, Golden, Metric, Threshold } from "../../src/index.ts";
import { expectFailureInstanceOf, runTest } from "../helpers/effect.ts";

// ── Stub judge model ─────────────────────────────────────────────────

/** One captured judge call: the rendered system and user prompt text. */
interface JudgeCall {
  readonly system: string;
  readonly user: string;
}

/** Builds a `LanguageModel` service whose structured-output hook returns canned JSON from `respond`. */
const makeJudgeStub = (
  respond: (call: JudgeCall) => unknown,
): Effect.Effect<{ readonly model: LanguageModel.LanguageModel; readonly calls: JudgeCall[] }> =>
  Effect.gen(function* () {
    const calls: JudgeCall[] = [];
    const model = yield* LanguageModel.make({
      generateText: (options) =>
        Effect.sync(() => {
          const systemMessage = options.prompt.content.find((message) => message.role === "system");
          const userMessage = options.prompt.content.findLast((message) => message.role === "user");
          const system = systemMessage?.role === "system" ? systemMessage.content : "";
          const user =
            userMessage?.role === "user"
              ? userMessage.content.map((part) => ("text" in part ? part.text : "")).join("")
              : "";
          const call = { system, user };
          calls.push(call);
          return [{ type: "text" as const, text: JSON.stringify(respond(call)) }];
        }),
      streamText: () => Stream.die("streamText is not used by gEval"),
    });
    return { model, calls };
  });

const provideJudge = (model: LanguageModel.LanguageModel) =>
  Layer.succeed(LanguageModel.LanguageModel, model);

/** A judge that dies if actually called — for tests expecting the model is never reached. */
const deadJudge = (): Promise<LanguageModel.LanguageModel> =>
  runTest(
    LanguageModel.make({
      generateText: () => Effect.die("gEval should not have called the judge"),
      streamText: () => Stream.die("gEval should not have called the judge"),
    }),
  );

// ── Fixtures ─────────────────────────────────────────────────────────

const TranslationGolden = Golden.Golden(Schema.String, Schema.String);
const TranslationCase = EvalCase.EvalCase(TranslationGolden, Schema.String);
type TranslationCase = typeof TranslationCase.Type;

const translationCase: TranslationCase = {
  golden: { input: "Bonjour le monde", expected: "Hello world" },
  output: "Hello world",
};

const ragCase: TranslationCase = {
  golden: { input: "Bonjour le monde", expected: "Hello world", context: ["greeting phrase"] },
  output: "Hello world",
  retrievedContext: ["Bonjour is a common French greeting"],
};

// ── Score normalisation ──────────────────────────────────────────────

describe("gEval — score normalisation", () => {
  it("normalises the judge's raw score against a rubric's scale", async () => {
    const rubric = GEval.makeRubric([
      { min: 0, max: 3, description: "poor" },
      { min: 4, max: 7, description: "adequate" },
      { min: 8, max: 10, description: "excellent" },
    ]);

    const metric: Metric.Metric<TranslationCase, GEval.GEvalError, LanguageModel.LanguageModel> =
      GEval.gEval({
        name: "translation-quality",
        evaluationSteps: ["Check meaning is preserved", "Check the translation reads fluently"],
        rubric,
        evaluationParams: ["input", "output"],
        threshold: Threshold.minScore(0.7),
      });

    const { model } = await runTest(
      makeJudgeStub(() => ({ score: 8, reason: "Faithful and fluent" })),
    );

    const result = await runTest(
      Metric.evaluate(metric, translationCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score.score).toBeCloseTo(0.8);
    expect(result.score.reason).toBe("Faithful and fluent");
    expect(result.passed).toBe(true);
    expect(result.score.metadata?.evaluationSteps).toEqual([
      "Check meaning is preserved",
      "Check the translation reads fluently",
    ]);
    expect(result.score.metadata?.rubric).toEqual(rubric);
  });

  it("clamps an out-of-range raw score to the rubric's scale before normalising", async () => {
    const rubric = GEval.makeRubric([{ min: 0, max: 10, description: "any" }]);
    const metric = GEval.gEval<TranslationCase>({
      name: "translation-quality",
      evaluationSteps: ["Check meaning is preserved"],
      rubric,
      evaluationParams: ["output"],
      threshold: Threshold.minScore(0),
    });

    const { model } = await runTest(makeJudgeStub(() => ({ score: 15, reason: "over-scale" })));
    const result = await runTest(
      Metric.evaluate(metric, translationCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score.score).toBe(1);
  });

  it("treats the judge's score as already 0..1 when no rubric is given", async () => {
    const metric = GEval.gEval<TranslationCase>({
      name: "translation-quality",
      evaluationSteps: ["Check meaning is preserved"],
      evaluationParams: ["output"],
      threshold: Threshold.minScore(0),
    });

    const { model } = await runTest(
      makeJudgeStub(() => ({ score: 0.42, reason: "partial credit" })),
    );
    const result = await runTest(
      Metric.evaluate(metric, translationCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score.score).toBe(0.42);
    expect(result.score.metadata?.rubric).toBeUndefined();
  });

  it("normalises against a rubric whose bands don't start at 0", async () => {
    const rubric = GEval.makeRubric([
      { min: 3, max: 6, description: "adequate" },
      { min: 7, max: 10, description: "excellent" },
    ]);
    const metric = GEval.gEval<TranslationCase>({
      name: "translation-quality",
      evaluationSteps: ["Check meaning is preserved"],
      rubric,
      evaluationParams: ["output"],
      threshold: Threshold.minScore(0),
    });

    // A raw score of 3 is the rubric's floor, so it should normalise to 0,
    // not (3 - 0) / 10 = 0.3 as a hardcoded 0-floor would compute.
    const { model } = await runTest(makeJudgeStub(() => ({ score: 3, reason: "floor" })));
    const result = await runTest(
      Metric.evaluate(metric, translationCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score.score).toBe(0);
  });

  it("normalises a below-floor raw score to 0 rather than silently accepting it", async () => {
    const rubric = GEval.makeRubric([{ min: 3, max: 10, description: "any" }]);
    const metric = GEval.gEval<TranslationCase>({
      name: "translation-quality",
      evaluationSteps: ["Check meaning is preserved"],
      rubric,
      evaluationParams: ["output"],
      threshold: Threshold.minScore(0),
    });

    const { model } = await runTest(makeJudgeStub(() => ({ score: 1, reason: "below floor" })));
    const result = await runTest(
      Metric.evaluate(metric, translationCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score.score).toBe(0);
  });

  it("normalises a single-point rubric to a perfect score", async () => {
    const rubric = GEval.makeRubric([{ min: 5, max: 5, description: "only valid value" }]);
    const metric = GEval.gEval<TranslationCase>({
      name: "translation-quality",
      evaluationSteps: ["Check meaning is preserved"],
      rubric,
      evaluationParams: ["output"],
      threshold: Threshold.minScore(0),
    });

    const { model } = await runTest(makeJudgeStub(() => ({ score: 5, reason: "the only value" })));
    const result = await runTest(
      Metric.evaluate(metric, translationCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score.score).toBe(1);
  });
});

// ── Evaluation param field selection ─────────────────────────────────

describe("gEval — evaluationParams field selection", () => {
  it("shows the judge context and retrievedContext fields when named", async () => {
    const metric = GEval.gEval<TranslationCase>({
      name: "translation-quality",
      evaluationSteps: ["Check the translation is grounded in the given context"],
      evaluationParams: ["context", "retrievedContext"],
      threshold: Threshold.minScore(0),
    });

    const { model, calls } = await runTest(makeJudgeStub(() => ({ score: 1, reason: "grounded" })));
    await runTest(Metric.evaluate(metric, ragCase).pipe(Effect.provide(provideJudge(model))));

    expect(calls[0]?.user).toContain("context:\ngreeting phrase");
    expect(calls[0]?.user).toContain("retrievedContext:\nBonjour is a common French greeting");
  });
});

// ── Criteria-derived vs. explicit evaluation steps ──────────────────

describe("gEval — criteria XOR evaluationSteps", () => {
  it("asks the judge to derive and report evaluation steps when criteria is given", async () => {
    const metric = GEval.gEval<TranslationCase>({
      name: "translation-quality",
      criteria: "Is this a faithful, fluent translation of the source?",
      evaluationParams: ["input", "output"],
      threshold: Threshold.minScore(0.5),
    });

    const { model, calls } = await runTest(
      makeJudgeStub(() => ({
        steps: ["Compare meaning against the source", "Judge fluency in the target language"],
        score: 0.9,
        reason: "Accurate and fluent",
      })),
    );

    const result = await runTest(
      Metric.evaluate(metric, translationCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score.score).toBe(0.9);
    expect(result.score.metadata?.evaluationSteps).toEqual([
      "Compare meaning against the source",
      "Judge fluency in the target language",
    ]);
    expect(calls[0]?.system).toContain(
      "First derive a numbered list of concrete evaluation steps that operationalise this criteria",
    );
  });

  it("throws when both criteria and evaluationSteps are given", () => {
    expect(() =>
      GEval.gEval<TranslationCase>({
        name: "bad-metric",
        criteria: "some criteria",
        evaluationSteps: ["a step"],
        evaluationParams: ["output"],
        threshold: Threshold.minScore(0.5),
      }),
    ).toThrow(/exactly one of/);
  });

  it("throws when neither criteria nor evaluationSteps are given", () => {
    expect(() =>
      GEval.gEval<TranslationCase>({
        name: "bad-metric",
        evaluationParams: ["output"],
        threshold: Threshold.minScore(0.5),
      }),
    ).toThrow(/exactly one of/);
  });

  it("treats an empty criteria string as not provided, so evaluationSteps alone is valid", () => {
    expect(() =>
      GEval.gEval<TranslationCase>({
        name: "ok-metric",
        criteria: "",
        evaluationSteps: ["a step"],
        evaluationParams: ["output"],
        threshold: Threshold.minScore(0.5),
      }),
    ).not.toThrow();
  });

  it("treats an empty evaluationSteps array as not provided, so criteria alone is valid", () => {
    expect(() =>
      GEval.gEval<TranslationCase>({
        name: "ok-metric",
        criteria: "Is it good?",
        evaluationSteps: [],
        evaluationParams: ["output"],
        threshold: Threshold.minScore(0.5),
      }),
    ).not.toThrow();
  });

  it("still throws when criteria is empty and evaluationSteps is also empty", () => {
    expect(() =>
      GEval.gEval<TranslationCase>({
        name: "bad-metric",
        criteria: "",
        evaluationSteps: [],
        evaluationParams: ["output"],
        threshold: Threshold.minScore(0.5),
      }),
    ).toThrow(/exactly one of/);
  });
});

// ── Rubric bounds ────────────────────────────────────────────────────

describe("GEval.makeRubric", () => {
  it("sorts bands and derives scaleMin/scaleMax from the lowest and highest bands", () => {
    const rubric = GEval.makeRubric([
      { min: 4, max: 10, description: "high" },
      { min: 0, max: 3, description: "low" },
    ]);
    expect(rubric.scaleMin).toBe(0);
    expect(rubric.scaleMax).toBe(10);
    expect(rubric.bands.map((band) => band.description)).toEqual(["low", "high"]);
  });

  it("derives a non-zero scaleMin from a rubric whose lowest band doesn't start at 0", () => {
    const rubric = GEval.makeRubric([{ min: 3, max: 10, description: "any" }]);
    expect(rubric.scaleMin).toBe(3);
    expect(rubric.scaleMax).toBe(10);
  });

  it("rejects an empty rubric", () => {
    expect(() => GEval.makeRubric([])).toThrow();
  });

  it("rejects a band whose min is greater than its max", () => {
    expect(() => GEval.makeRubric([{ min: 5, max: 2, description: "inverted" }])).toThrow();
  });

  it("rejects overlapping bands", () => {
    expect(() =>
      GEval.makeRubric([
        { min: 0, max: 5, description: "a" },
        { min: 4, max: 10, description: "b" },
      ]),
    ).toThrow(/overlap/);
  });
});

// ── Missing evaluation param ─────────────────────────────────────────

describe("gEval — missing evaluation params", () => {
  it("fails with a typed error, and never calls the judge, when a required field is absent", async () => {
    const metric = GEval.gEval<TranslationCase>({
      name: "translation-quality",
      evaluationSteps: ["Check meaning is preserved"],
      evaluationParams: ["input", "expected"],
      threshold: Threshold.minScore(0.5),
    });

    const caseWithoutExpected: TranslationCase = {
      golden: { input: "Bonjour" },
      output: "Hello",
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
    expect(failure.metric).toBe("translation-quality");
  });

  it("treats an explicit null field the same as a missing one", async () => {
    const metric = GEval.gEval<TranslationCase>({
      name: "translation-quality",
      evaluationSteps: ["Check meaning is preserved"],
      evaluationParams: ["expected"],
      threshold: Threshold.minScore(0.5),
    });

    const caseWithNullExpected: TranslationCase = {
      golden: { input: "Bonjour", expected: null as unknown as string },
      output: "Hello",
    };

    const model = await deadJudge();

    const failure = (await expectFailureInstanceOf(
      Metric.evaluate(metric, caseWithNullExpected).pipe(
        Effect.provide(provideJudge(model)),
        Effect.asVoid,
      ),
      GEval.MissingEvaluationParamError,
    )) as GEval.MissingEvaluationParamError;

    expect(failure.param).toBe("expected");
  });
});

// ── Conversational rendering ─────────────────────────────────────────

describe("gEvalConversational", () => {
  const SupportGolden = Golden.ConversationalGolden(Schema.String);
  type SupportCase = typeof SupportGolden.Type;

  const supportCase: SupportCase = {
    turns: Prompt.make([
      { role: "user", content: "My order hasn't arrived" },
      { role: "assistant", content: "Can you share the order number?" },
    ]),
    scenario: "delayed-order",
  };

  it("renders the full turn history for the judge and scores the exchange holistically", async () => {
    const metric = GEval.gEvalConversational<SupportCase>({
      name: "helpfulness",
      evaluationSteps: ["Check the assistant asks for information it needs to help"],
      evaluationParams: ["scenario"],
      threshold: Threshold.minScore(0.5),
    });

    const { model, calls } = await runTest(
      makeJudgeStub(() => ({ score: 0.75, reason: "Asked a clarifying question" })),
    );

    const result = await runTest(
      Metric.evaluate(metric, supportCase).pipe(Effect.provide(provideJudge(model))),
    );

    expect(result.score.score).toBe(0.75);
    expect(result.score.reason).toBe("Asked a clarifying question");
    expect(calls[0]?.user).toContain("[user] My order hasn't arrived");
    expect(calls[0]?.user).toContain("[assistant] Can you share the order number?");
    expect(calls[0]?.user).toContain("scenario:\ndelayed-order");
  });

  it("renders turns via the exported renderTurns helper", () => {
    const rendered = GEval.renderTurns(supportCase.turns);
    expect(rendered).toBe(
      "[user] My order hasn't arrived\n\n[assistant] Can you share the order number?",
    );
  });

  it("renders a leading system message in the transcript", () => {
    const turns = Prompt.make([
      { role: "system", content: "You are a support agent." },
      { role: "user", content: "Hi" },
    ]);
    expect(GEval.renderTurns(turns)).toBe("[system] You are a support agent.\n\n[user] Hi");
  });

  it("shows the judge expectedOutcome and context fields when named", async () => {
    const caseWithMoreParams: SupportCase = {
      ...supportCase,
      expectedOutcome: "asks for the order number",
      context: ["order-support"],
    };

    const metric = GEval.gEvalConversational<SupportCase>({
      name: "helpfulness",
      evaluationSteps: ["Check the assistant asks for information it needs to help"],
      evaluationParams: ["expectedOutcome", "context"],
      threshold: Threshold.minScore(0),
    });

    const { model, calls } = await runTest(makeJudgeStub(() => ({ score: 0.5, reason: "n/a" })));
    await runTest(
      Metric.evaluate(metric, caseWithMoreParams).pipe(Effect.provide(provideJudge(model))),
    );

    expect(calls[0]?.user).toContain("expectedOutcome:\nasks for the order number");
    expect(calls[0]?.user).toContain("context:\norder-support");
  });
});

// ── Default template ─────────────────────────────────────────────────

describe("GEval.defaultTemplate", () => {
  it("renders explicit-steps system prompt without a criteria-derivation instruction", () => {
    const system = GEval.defaultTemplate.system({
      name: "translation-quality",
      evaluationSteps: ["Check meaning is preserved", "Check fluency"],
      fields: [],
    });

    expect(system).toBe(
      [
        'You are an expert evaluator scoring "translation-quality".',
        "",
        "Apply these evaluation steps, in order:",
        "1. Check meaning is preserved",
        "2. Check fluency",
        "",
        "Score on a continuous scale of 0 to 1, where 1 is a perfect match to the criteria.",
        "",
        "Always provide a concise reason justifying the score.",
      ].join("\n"),
    );
  });

  it("renders a criteria system prompt with a rubric's bands", () => {
    const rubric = GEval.makeRubric([
      { min: 0, max: 4, description: "poor" },
      { min: 5, max: 10, description: "good" },
    ]);

    const system = GEval.defaultTemplate.system({
      name: "helpfulness",
      criteria: "Is the response helpful?",
      rubric,
      fields: [],
    });

    expect(system).toBe(
      [
        'You are an expert evaluator scoring "helpfulness".',
        "",
        "Evaluation criteria: Is the response helpful?",
        "",
        "First derive a numbered list of concrete evaluation steps that operationalise this criteria, then apply them.",
        "",
        "Score on a scale of 0 to 10, using these bands:",
        "- 0-4: poor",
        "- 5-10: good",
        "",
        "Always provide a concise reason justifying the score.",
      ].join("\n"),
    );
  });

  it("renders the user prompt as label/value pairs", () => {
    const user = GEval.defaultTemplate.user({
      name: "translation-quality",
      evaluationSteps: [],
      fields: [
        { label: "input", value: "Bonjour" },
        { label: "output", value: "Hello" },
      ],
    });

    expect(user).toBe("input:\nBonjour\n\noutput:\nHello");
  });
});
