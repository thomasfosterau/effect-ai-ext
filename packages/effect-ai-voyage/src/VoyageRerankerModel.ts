/**
 * `VoyageRerankerModel` — the Voyage AI implementation of effect-ai-ext's
 * `RerankerModel` service. It maps a query and candidate documents onto
 * Voyage's `/v1/rerank` request (via {@link VoyageClient}), then converts the
 * scored results back into a `RerankerModel.ProviderResponse`. The abstraction
 * validates the indices, deduplicates, and sorts by descending relevance.
 *
 * @module VoyageRerankerModel
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as RerankerModel from "@thomasfosterau/effect-ai-ext/RerankerModel";
import { VoyageClient } from "./VoyageClient";
import type * as Wire from "./internal/wire";

/**
 * A selection of well-known Voyage reranker model ids, offered for
 * autocomplete only — the constructors accept any string.
 */
export type Model =
  | "rerank-2.5"
  | "rerank-2.5-lite"
  | "rerank-2"
  | "rerank-2-lite"
  | "rerank-1"
  | "rerank-lite-1";

/** The current Voyage reranker model ids. */
export const RERANKER_MODELS: ReadonlyArray<Model> = [
  "rerank-2.5",
  "rerank-2.5-lite",
  "rerank-2",
  "rerank-2-lite",
];

// =============================================================================
// Options
// =============================================================================

/** Configuration for constructing a {@link VoyageRerankerModel}. */
export interface Options {
  /** The Voyage reranker model id. Any string is accepted. */
  readonly model: (string & Record<never, never>) | Model;
  /**
   * Whether Voyage truncates over-length inputs (`true`) instead of failing
   * the request. Voyage defaults to `true`.
   */
  readonly truncation?: boolean | undefined;
}

// =============================================================================
// Reranker Model
// =============================================================================

/**
 * Constructs a `RerankerModel.Service` backed by {@link VoyageClient}.
 *
 * The abstraction short-circuits an empty `documents` array without calling
 * Voyage, and validates and re-sorts the provider's results.
 *
 * @see {@link layer} for providing the service as a `Layer`
 */
export const make = Effect.fnUntraced(function* (
  options: Options,
): Effect.fn.Return<RerankerModel.Service, never, VoyageClient> {
  const client = yield* VoyageClient;

  return yield* RerankerModel.make({
    rerank: ({ query, documents, topN }) =>
      client
        .createRerank({
          model: options.model,
          query,
          documents,
          ...(Predicate.isNotUndefined(topN) ? { top_k: topN } : undefined),
          ...(Predicate.isNotUndefined(options.truncation)
            ? { truncation: options.truncation }
            : undefined),
        })
        .pipe(Effect.map(([body]) => mapResponse(body))),
  });
});

/**
 * Provides {@link VoyageRerankerModel} as a `RerankerModel.RerankerModel`
 * layer, drawing {@link VoyageClient} from another layer.
 */
export const layer = (
  options: Options,
): Layer.Layer<RerankerModel.RerankerModel, never, VoyageClient> =>
  Layer.effect(RerankerModel.RerankerModel, make(options));

// =============================================================================
// Response Conversion
// =============================================================================

/** Converts a Voyage rerank response into a `RerankerModel.ProviderResponse`. */
const mapResponse = (body: Wire.RerankResponse): RerankerModel.ProviderResponse => ({
  results: body.data.map((datum) => ({
    index: datum.index,
    relevanceScore: datum.relevance_score,
  })),
  usage: { inputTokens: body.usage?.total_tokens },
});
