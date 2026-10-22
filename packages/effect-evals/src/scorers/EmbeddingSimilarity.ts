/**
 * `embeddingSimilarity` — cosine similarity between a case's `output` and
 * its golden's `expected`, both embedded through the ambient `EmbeddingModel`
 * service (`effect/ai`) so any provider layer can back it
 * (autoevals' `EmbeddingSimilarity`). This package takes no provider
 * dependency itself — `EmbeddingModel` lives in `R`, and a caller provides a
 * concrete layer (the Cohere gateway layer is wired at call sites in
 * website#931, never here); tests stub the service directly.
 *
 * @module scorers/EmbeddingSimilarity
 *
 * @copyright Thomas Foster
 */

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Number from "effect/Number";
import { AiError, EmbeddingModel } from "effect/ai";
import * as Scorer from "../Scorer.ts";
import type { StringCase } from "./StringCase.ts";

/** Dot-product cosine similarity, `[-1, 1]`; `0` when either vector is the zero vector. */
const cosineSimilarity = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
  const { dot, normA, normB } = Arr.reduce(
    Arr.zip(a, b),
    { dot: 0, normA: 0, normB: 0 },
    (sums, [x, y]) => ({
      dot: sums.dot + x * y,
      normA: sums.normA + x * x,
      normB: sums.normB + y * y,
    }),
  );
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
};

/** Maps cosine similarity's `[-1, 1]` range onto {@link Score.Score}'s required `[0, 1]`, clamping float overshoot at either end. */
const toUnitScore = (similarity: number): number =>
  Number.clamp({ minimum: 0, maximum: 1 })((similarity + 1) / 2);

/**
 * Cosine similarity between `evalCase.output` and `evalCase.golden.expected`,
 * embedded via the `EmbeddingModel` service in `R`. Scores `0` (without
 * calling the model) when the golden has no `expected` to compare against.
 */
export const embeddingSimilarity: Scorer.Scorer<
  StringCase,
  AiError.AiError,
  EmbeddingModel.EmbeddingModel
> = Scorer.makeScorer({
  name: "embedding-similarity",
  evaluate: (evalCase) =>
    Effect.gen(function* () {
      const { expected } = evalCase.golden;
      if (expected === undefined) {
        return { score: 0, reason: "golden.expected is undefined" };
      }

      const model = yield* EmbeddingModel.EmbeddingModel;
      const response = yield* model.embedMany([evalCase.output, expected]);
      const [outputEmbedding, expectedEmbedding] = response.embeddings;
      if (outputEmbedding === undefined || expectedEmbedding === undefined) {
        // `embedMany` already rejects a response with the wrong embedding
        // count; this narrows the destructured pair for the type checker.
        return yield* AiError.make({
          module: "EmbeddingSimilarity",
          method: "evaluate",
          reason: new AiError.InvalidOutputError({
            description: `Expected 2 embeddings but received ${response.embeddings.length}`,
          }),
        });
      }

      return {
        score: toUnitScore(cosineSimilarity(outputEmbedding.vector, expectedEmbedding.vector)),
      };
    }),
});
