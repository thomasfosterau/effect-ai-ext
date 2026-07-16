/**
 * @copyright Thomas Foster
 *
 * `contextualRecall` — the fraction of statements in `expected` that are
 * attributable to `retrievedContext`: a thin configuration of
 * {@link ExtractThenClassify.extractThenClassifyRatio} (extract statements
 * from `expected`, classify each against `retrievedContext`).
 *
 * @module metrics/rag/ContextualRecall
 */

import * as Effect from "effect/Effect";
import { LanguageModel } from "effect/unstable/ai";
import { makeMetric, type Metric } from "../../Metric";
import { makeScorer } from "../../Scorer";
import type { Threshold } from "../../Threshold";
import { extractThenClassifyRatio } from "./ExtractThenClassify";
import {
  renderContext,
  renderValue,
  requireExpected,
  requireRetrievedContext,
  type RagCase,
  type RagMetricError,
} from "./RagCase";

const EXTRACT_INSTRUCTIONS =
  "Extract every atomic statement made in the given expected output. Each statement should be a standalone, verifiable claim, free of pronouns and other context-dependent phrasing.";

const CLASSIFY_INSTRUCTIONS =
  'For each statement, decide whether it can be attributed to (is supported by) the given retrieved context. Answer "yes" if the context supports the statement, "no" if the context does not contain or support it.';

/** Options for {@link contextualRecall}. */
export interface ContextualRecallOptions {
  readonly threshold: Threshold;
  readonly name?: string;
}

/**
 * Builds the `contextualRecall` {@link Metric}: requires `expected` and
 * `retrievedContext` on the case.
 */
export const contextualRecall = <Case extends RagCase = RagCase>(
  options: ContextualRecallOptions,
): Metric<Case, RagMetricError, LanguageModel.LanguageModel> => {
  const name = options.name ?? "contextual-recall";

  const scorer = makeScorer<Case, RagMetricError, LanguageModel.LanguageModel>({
    name,
    evaluate: (evalCase) =>
      Effect.gen(function* () {
        const expected = yield* requireExpected(name, evalCase);
        const retrievedContext = yield* requireRetrievedContext(name, evalCase);
        return yield* extractThenClassifyRatio({
          extract: {
            instructions: EXTRACT_INSTRUCTIONS,
            label: "expected",
            text: renderValue(expected),
          },
          classify: {
            instructions: CLASSIFY_INSTRUCTIONS,
            referenceLabel: "retrievedContext",
            referenceText: renderContext(retrievedContext),
          },
        });
      }),
  });

  return makeMetric({ name, scorer, threshold: options.threshold });
};
