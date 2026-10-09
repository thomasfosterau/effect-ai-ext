/**
 * `CohereRerankerModel` — the Cohere implementation of effect-ai-ext's
 * `RerankerModel` service over Cohere's `/v2/rerank` endpoint (via
 * {@link CohereClient}). It scores and reorders candidate documents against a
 * query.
 *
 * The pinned model (`rerank-v3.5`) lives here as the single source of truth.
 * The abstraction's `make` validates and normalises the provider results (see
 * `@thomasfosterau/effect-ai-ext/RerankerModel`), so this module only maps
 * Cohere's wire response into the provider-response contract.
 *
 * @module CohereRerankerModel
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RerankerModel from "@thomasfosterau/effect-ai-ext/RerankerModel";
import { CohereClient } from "./CohereClient";

/** Cohere's reranker model. A single constant so rotation is one edit. */
export const RERANK_MODEL = "rerank-v3.5";

/** Configuration for constructing a {@link CohereRerankerModel}. */
export interface Options {
  /**
   * The reranker model id.
   *
   * @default "rerank-v3.5"
   */
  readonly model?: string | undefined;
}

/**
 * Constructs a `RerankerModel.Service` backed by {@link CohereClient}.
 *
 * @see {@link layer} for providing the service as a `Layer`
 */
export const make = (
  options?: Options,
): Effect.Effect<RerankerModel.Service, never, CohereClient> =>
  Effect.gen(function* () {
    const client = yield* CohereClient;
    const model = options?.model ?? RERANK_MODEL;
    return yield* RerankerModel.make({
      rerank: ({ query, documents, topN }) =>
        client
          .rerank({
            model,
            query,
            documents,
            ...(topN !== undefined ? { top_n: topN } : undefined),
          })
          .pipe(
            Effect.map((response) => ({
              results: response.results.map((entry) => ({
                index: entry.index,
                relevanceScore: entry.relevance_score,
              })),
              usage: { inputTokens: response.meta?.billed_units?.search_units },
            })),
          ),
    });
  });

/**
 * Provides {@link CohereRerankerModel} as a `RerankerModel` layer, drawing
 * {@link CohereClient} from another layer.
 */
export const layer = (
  options?: Options,
): Layer.Layer<RerankerModel.RerankerModel, never, CohereClient> =>
  Layer.effect(RerankerModel.RerankerModel, make(options));
