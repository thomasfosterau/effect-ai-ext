/**
 * `contextualPrecision` — weighted cumulative precision over the ranked
 * `retrievedContext` chunks: rewards relevant chunks ranked higher, needs
 * `expected` to judge relevance against. Unlike the suite's other four
 * metrics, there's nothing to extract — the chunks are already the atomic
 * units — so this reuses only
 * {@link ExtractThenClassify.classifyStatements} (treating the ranked
 * chunks as the "statements" to classify) and applies
 * {@link weightedCumulativePrecision}, a pure function kept separate from
 * the judge call so it can be tested directly against a hand-computed
 * fixture.
 *
 * DeepEval's formula: `(1/|relevant|) · Σₖ (relevant@k / k) · rₖ`, where `k`
 * ranges over the ranked positions (1-indexed), `relevant@k` is the count of
 * relevant chunks among the first `k`, and `rₖ` is `1` when the chunk at
 * position `k` is itself relevant (`0` otherwise) — so only relevant
 * positions contribute a term, each weighted by the precision at that
 * position. A relevant chunk ranked earlier (a smaller `k` in its
 * precision-at-k term, with a smaller cumulative-count denominator overall)
 * contributes more than the same chunk ranked later.
 *
 * @module metrics/rag/ContextualPrecision
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import { LanguageModel } from "effect/ai";
import * as Metric from "../../Metric.ts";
import * as Scorer from "../../Scorer.ts";
import type { Score } from "../../Score.ts";
import type { Threshold } from "../../Threshold.ts";
import { classifyStatements, type Verdict } from "./ExtractThenClassify.ts";
import {
  renderValue,
  requireExpected,
  requireRetrievedContext,
  type RagCase,
  type RagMetricError,
} from "./RagCase.ts";

const CLASSIFY_INSTRUCTIONS =
  'For each retrieved context chunk, decide whether it is relevant to producing the given expected output. Answer "yes" if the chunk is relevant, "no" if it is not.';

/**
 * Weighted cumulative precision over an ordered relevance sequence (`true`
 * where the chunk at that rank is relevant). `0` when nothing is relevant —
 * with no relevant chunks the ranking rewards nothing, rather than being
 * left undefined.
 */
export const weightedCumulativePrecision = (relevance: ReadonlyArray<boolean>): number => {
  const relevantCount = relevance.filter(Boolean).length;
  if (relevantCount === 0) return 0;

  let sum = 0;
  let runningRelevant = 0;
  for (let position = 0; position < relevance.length; position++) {
    if (relevance[position]) {
      runningRelevant++;
      sum += runningRelevant / (position + 1);
    }
  }
  return sum / relevantCount;
};

const summarizePrecisionVerdicts = (verdicts: ReadonlyArray<Verdict>): string => {
  if (verdicts.length === 0) return "No retrieved context to evaluate.";

  let relevantCount = 0;
  const irrelevant: string[] = [];
  verdicts.forEach((verdict, index) => {
    if (verdict.verdict === "yes") {
      relevantCount++;
      return;
    }
    const rank = index + 1;
    irrelevant.push(
      verdict.reason
        ? `- [${rank}] ${verdict.statement}: ${verdict.reason}`
        : `- [${rank}] ${verdict.statement}`,
    );
  });

  const summary = `${relevantCount}/${verdicts.length} retrieved chunks relevant.`;
  return irrelevant.length > 0 ? [summary, ...irrelevant].join("\n") : summary;
};

/** Options for {@link contextualPrecision}. */
export interface ContextualPrecisionOptions {
  readonly threshold: Threshold;
  readonly name?: string;
}

/**
 * Builds the `contextualPrecision` {@link Metric}: requires `expected` and
 * `retrievedContext` on the case.
 */
export const contextualPrecision = <Case extends RagCase = RagCase>(
  options: ContextualPrecisionOptions,
): Metric.Metric<Case, RagMetricError, LanguageModel.LanguageModel> => {
  const name = options.name ?? "contextual-precision";

  const scorer = Scorer.makeScorer<Case, RagMetricError, LanguageModel.LanguageModel>({
    name,
    evaluate: (evalCase): Effect.Effect<Score, RagMetricError, LanguageModel.LanguageModel> =>
      Effect.gen(function* () {
        const expected = yield* requireExpected(name, evalCase);
        const retrievedContext = yield* requireRetrievedContext(name, evalCase);

        if (retrievedContext.length === 0) {
          return {
            score: 0,
            reason: "No retrieved context to evaluate.",
            metadata: { verdicts: [] },
          };
        }

        const verdicts = yield* classifyStatements({
          instructions: CLASSIFY_INSTRUCTIONS,
          statements: retrievedContext,
          referenceLabel: "expected",
          referenceText: renderValue(expected),
          itemsLabel: "retrieved context chunks",
        });

        const relevance = verdicts.map((verdict) => verdict.verdict === "yes");

        return {
          score: weightedCumulativePrecision(relevance),
          reason: summarizePrecisionVerdicts(verdicts),
          metadata: { verdicts },
        };
      }),
  });

  return Metric.makeMetric({ name, scorer, threshold: options.threshold });
};
