/**
 * @copyright Thomas Foster
 *
 * Shared building blocks for the CLI's fixture `*.eval.ts` files
 * (`tests/cli/*.test.ts`, and `node bin/effect-evals.js run tests/fixtures/*`)
 * — several fixtures need the same "call the judge `LanguageModel`, exact-
 * match the result" shape; factored out rather than duplicated per fixture.
 *
 * @module tests/fixtures/_shared
 */

import * as Effect from "effect/Effect";
import { AiError, LanguageModel } from "effect/ai";
import { Metric, Runner, Scorer, Threshold } from "../../src/index.ts";

/** A task that prompts the (fixture-provided) judge `LanguageModel` with the golden and returns its text. */
export const languageModelTask = (
  id: string,
): Runner.TaskDefinition<string, string, AiError.AiError, LanguageModel.LanguageModel> =>
  Runner.makeTask({
    id,
    run: (golden) =>
      Effect.gen(function* () {
        const model = yield* LanguageModel.LanguageModel;
        const response = yield* model.generateText({ prompt: golden });
        return response.text;
      }),
  });

/** An exact-match `Metric` over a `string` case, given how to compare `golden`/`output`. */
export const exactMatchMetric = (
  matches: (evalCase: Runner.EvaluatedCase<string, string>) => boolean,
): Metric.Metric<Runner.EvaluatedCase<string, string>> =>
  Metric.makeMetric({
    name: "exact-match",
    scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
      name: "exact-match",
      evaluate: (evalCase) => Effect.succeed({ score: matches(evalCase) ? 1 : 0 }),
    }),
    threshold: Threshold.strict,
  });
