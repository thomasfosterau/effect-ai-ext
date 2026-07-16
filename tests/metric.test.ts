/**
 * Scorer composition and `Metric.evaluate` tests: a scorer's judge dependency
 * lives in `R` and its failure is typed in `E`, exercised end to end through
 * a metric's threshold policy.
 *
 * @module tests/metric
 */

import { describe, expect, it } from "vite-plus/test";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { EvalCase, Golden, Metric, Scorer, Threshold } from "@thomasfosterau/effect-evals";
import { expectFailureInstanceOf, runTest } from "@test-helpers/effect";

const TranslationGolden = Golden.Golden(Schema.String, Schema.String);
const TranslationCase = EvalCase.EvalCase(TranslationGolden, Schema.String);
type TranslationCase = typeof TranslationCase.Type;

const golden: typeof TranslationGolden.Type = { input: "Bonjour", expected: "Hello" };
const matchingCase: TranslationCase = { golden, output: "Hello" };
const mismatchingCase: TranslationCase = { golden, output: "Bonjour" };

describe("Scorer + Metric — dependency-free scorer", () => {
  const exactMatchScorer: Scorer.Scorer<TranslationCase> = Scorer.makeScorer({
    name: "exact-match",
    evaluate: (evalCase) =>
      Effect.succeed(
        evalCase.golden.expected === evalCase.output
          ? { score: 1, reason: "matched" }
          : { score: 0, reason: "mismatched" },
      ),
  });

  const metric = Metric.makeMetric({
    name: "exact-match",
    scorer: exactMatchScorer,
    threshold: Threshold.strict,
  });

  it("passes a matching case under a strict threshold", async () => {
    const result = await runTest(Metric.evaluate(metric, matchingCase));
    expect(result.score.score).toBe(1);
    expect(result.passed).toBe(true);
  });

  it("fails a mismatching case under a strict threshold", async () => {
    const result = await runTest(Metric.evaluate(metric, mismatchingCase));
    expect(result.score.score).toBe(0);
    expect(result.passed).toBe(false);
  });
});

class JudgeError {
  readonly _tag = "JudgeError";
  constructor(readonly message: string) {}
}

interface JudgeService {
  readonly rate: (output: string, expected: string) => Effect.Effect<number, JudgeError>;
}

class Judge extends Context.Service<Judge, JudgeService>()("tests/Metric/Judge") {}

describe("Scorer + Metric — judge-backed scorer", () => {
  const judgeScorer: Scorer.Scorer<TranslationCase, JudgeError, Judge> = Scorer.makeScorer({
    name: "judge-similarity",
    evaluate: (evalCase) =>
      Effect.gen(function* () {
        const judge = yield* Judge;
        const score = yield* judge.rate(evalCase.output, evalCase.golden.expected ?? "");
        return { score };
      }),
  });

  const metric = Metric.makeMetric({
    name: "judge-similarity",
    scorer: judgeScorer,
    threshold: Threshold.minScore(0.5),
  });

  it("resolves the judge from R and applies the threshold to its score", async () => {
    const layer = Layer.succeed(Judge, { rate: () => Effect.succeed(0.8) });

    const result = await runTest(Metric.evaluate(metric, matchingCase).pipe(Effect.provide(layer)));
    expect(result.score.score).toBe(0.8);
    expect(result.passed).toBe(true);
  });

  it("surfaces the judge's typed failure rather than throwing", async () => {
    const layer = Layer.succeed(Judge, { rate: () => Effect.fail(new JudgeError("timeout")) });

    await expectFailureInstanceOf(
      Metric.evaluate(metric, matchingCase).pipe(Effect.provide(layer), Effect.asVoid),
      JudgeError,
    );
  });
});
