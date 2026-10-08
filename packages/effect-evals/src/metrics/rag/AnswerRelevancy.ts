/**
 * `answerRelevancy` — the fraction of statements in `output` that are
 * relevant to `input`: a thin configuration of
 * {@link ExtractThenClassify.extractThenClassifyRatio} (extract statements
 * from `output`, classify each against `input`).
 *
 * @module metrics/rag/AnswerRelevancy
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import { LanguageModel } from "effect/ai";
import * as Metric from "../../Metric.ts";
import * as Scorer from "../../Scorer.ts";
import type { Threshold } from "../../Threshold.ts";
import { extractThenClassifyRatio } from "./ExtractThenClassify.ts";
import {
  renderValue,
  requireInput,
  requireOutput,
  type RagCase,
  type RagMetricError,
} from "./RagCase.ts";

const EXTRACT_INSTRUCTIONS =
  "Extract every atomic statement made in the given output. Each statement should be a standalone, verifiable claim, free of pronouns and other context-dependent phrasing.";

const CLASSIFY_INSTRUCTIONS =
  'For each statement, decide whether it is relevant to answering the given input. Answer "yes" if the statement helps address the input, "no" if it is off-topic or irrelevant.';

/** Options for {@link answerRelevancy}. */
export interface AnswerRelevancyOptions {
  readonly threshold: Threshold;
  readonly name?: string;
}

/**
 * Builds the `answerRelevancy` {@link Metric}: requires `input` and
 * `output` on the case.
 */
export const answerRelevancy = <Case extends RagCase = RagCase>(
  options: AnswerRelevancyOptions,
): Metric.Metric<Case, RagMetricError, LanguageModel.LanguageModel> => {
  const name = options.name ?? "answer-relevancy";

  const scorer = Scorer.makeScorer<Case, RagMetricError, LanguageModel.LanguageModel>({
    name,
    evaluate: (evalCase) =>
      Effect.gen(function* () {
        const input = yield* requireInput(name, evalCase);
        const output = yield* requireOutput(name, evalCase);
        return yield* extractThenClassifyRatio({
          extract: {
            instructions: EXTRACT_INSTRUCTIONS,
            label: "output",
            text: renderValue(output),
          },
          classify: {
            instructions: CLASSIFY_INSTRUCTIONS,
            referenceLabel: "input",
            referenceText: renderValue(input),
          },
        });
      }),
  });

  return Metric.makeMetric({ name, scorer, threshold: options.threshold });
};
