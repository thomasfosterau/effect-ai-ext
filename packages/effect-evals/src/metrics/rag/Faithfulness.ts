/**
 * @copyright Thomas Foster
 *
 * `faithfulness` — the fraction of claims made in `output` that aren't
 * contradicted by `retrievedContext`: a thin configuration of
 * {@link ExtractThenClassify.extractThenClassifyRatio} (extract claims from
 * `output`, classify each against `retrievedContext`). Scores `0` without
 * calling the judge when `retrievedContext` is empty — nothing was retrieved
 * to check claims against, so "not contradicted" would otherwise be
 * vacuously true for every claim (mirrors `ContextualPrecision`'s same
 * guard).
 *
 * @module metrics/rag/Faithfulness
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
  requireOutput,
  requireRetrievedContext,
  type RagCase,
  type RagMetricError,
} from "./RagCase.ts";

const EXTRACT_INSTRUCTIONS =
  "Extract every atomic factual claim made in the given output. Each claim should be a standalone, verifiable statement, free of pronouns and other context-dependent phrasing.";

const CLASSIFY_INSTRUCTIONS =
  'For each claim, decide whether it is contradicted by the given retrieved context. Answer "no" only when the context explicitly contradicts the claim; answer "yes" when the claim is supported by the context or simply isn\'t addressed by it (no contradiction is not the same as unsupported).';

/** Options for {@link faithfulness}. */
export interface FaithfulnessOptions {
  readonly threshold: Threshold;
  readonly name?: string;
}

/**
 * Builds the `faithfulness` {@link Metric}: requires `output` and
 * `retrievedContext` on the case.
 */
export const faithfulness = <Case extends RagCase = RagCase>(
  options: FaithfulnessOptions,
): Metric<Case, RagMetricError, LanguageModel.LanguageModel> => {
  const name = options.name ?? "faithfulness";

  const scorer = makeScorer<Case, RagMetricError, LanguageModel.LanguageModel>({
    name,
    evaluate: (evalCase) =>
      Effect.gen(function* () {
        const output = yield* requireOutput(name, evalCase);
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
            label: "output",
            text: renderValue(output),
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
