/**
 * @copyright Thomas Foster
 *
 * `contextualRelevancy` — the fraction of statements in `retrievedContext`
 * that are relevant to `input`: a thin configuration of
 * {@link ExtractThenClassify.extractThenClassifyRatio} (extract statements
 * from `retrievedContext`, classify each against `input`). Referenceless —
 * unlike `contextualPrecision`/`contextualRecall`, it needs no `expected`.
 * Scores `0` without calling the judge when `retrievedContext` is empty
 * (mirrors `ContextualPrecision`'s same guard) — extracting from empty text
 * would otherwise vacuously find zero statements and score a perfect `1`.
 *
 * @module metrics/rag/ContextualRelevancy
 */

import * as Effect from "effect/Effect";
import { LanguageModel } from "effect/ai";
import { makeMetric, type Metric } from "../../Metric.ts";
import { makeScorer } from "../../Scorer.ts";
import type { Threshold } from "../../Threshold.ts";
import { extractThenClassifyRatio } from "./ExtractThenClassify.ts";
import {
  renderContext,
  renderValue,
  requireInput,
  requireRetrievedContext,
  type RagCase,
  type RagMetricError,
} from "./RagCase.ts";

const EXTRACT_INSTRUCTIONS =
  "Extract every atomic statement made across the given retrieved context. Each statement should be a standalone, verifiable claim, free of pronouns and other context-dependent phrasing.";

const CLASSIFY_INSTRUCTIONS =
  'For each statement, decide whether it is relevant to answering the given input. Answer "yes" if the statement helps address the input, "no" if it is off-topic or irrelevant.';

/** Options for {@link contextualRelevancy}. */
export interface ContextualRelevancyOptions {
  readonly threshold: Threshold;
  readonly name?: string;
}

/**
 * Builds the `contextualRelevancy` {@link Metric}: requires `input` and
 * `retrievedContext` on the case.
 */
export const contextualRelevancy = <Case extends RagCase = RagCase>(
  options: ContextualRelevancyOptions,
): Metric<Case, RagMetricError, LanguageModel.LanguageModel> => {
  const name = options.name ?? "contextual-relevancy";

  const scorer = makeScorer<Case, RagMetricError, LanguageModel.LanguageModel>({
    name,
    evaluate: (evalCase) =>
      Effect.gen(function* () {
        const input = yield* requireInput(name, evalCase);
        const retrievedContext = yield* requireRetrievedContext(name, evalCase);

        if (retrievedContext.length === 0) {
          return {
            score: 0,
            reason: "No retrieved context to evaluate.",
            metadata: { statements: [], verdicts: [] },
          };
        }

        return yield* extractThenClassifyRatio({
          extract: {
            instructions: EXTRACT_INSTRUCTIONS,
            label: "retrievedContext",
            text: renderContext(retrievedContext),
          },
          classify: {
            instructions: CLASSIFY_INSTRUCTIONS,
            referenceLabel: "input",
            referenceText: renderValue(input),
          },
        });
      }),
  });

  return makeMetric({ name, scorer, threshold: options.threshold });
};
