/**
 * @copyright Thomas Foster
 *
 * `RerankerModel` — provider-neutral Effect service for reranking
 * candidate documents against a query, the sibling of `LanguageModel`
 * and `EmbeddingModel` from `effect/unstable/ai` (which has no reranker
 * module yet).
 *
 * The shape deliberately mirrors `EmbeddingModel`: providers supply one
 * `rerank` function through {@link make}, provider results are validated
 * (every index in range, no duplicates, no more results than requested)
 * and normalised to descending relevance order, and provider failures
 * stay represented as `AiError` values. Consumers depend on the
 * {@link RerankerModel} tag; `Cohere.ts`'s `makeCohereReranker` builds it
 * — the same seam `Anthropic.ts` fills for `LanguageModel`.
 *
 * **Gotchas**
 *
 * - `rerank` with an empty `documents` array returns an empty response
 *   without invoking the provider.
 * - Result `index` values refer to positions in the caller's input
 *   `documents` array; results are returned sorted by descending
 *   `relevanceScore` regardless of provider ordering.
 *
 * @module RerankerModel
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AiError } from "effect/unstable/ai";

/** Effect service tag for reranker model operations. */
export class RerankerModel extends Context.Service<RerankerModel, Service>()("RerankerModel") {}

/**
 * Token usage metadata for a rerank operation. `inputTokens` is
 * `undefined` when the provider does not report usage or when the empty
 * input short-circuit bypassed the provider.
 */
// Public surface of the reranker abstraction.
export class RerankerUsage extends Schema.Class<RerankerUsage>("RerankerModel/RerankerUsage")({
  inputTokens: Schema.UndefinedOr(Schema.Finite),
}) {}

/** One reranked document: input position plus provider relevance. */
export class RerankedDocument extends Schema.Class<RerankedDocument>(
  "RerankerModel/RerankedDocument",
)({
  /** Index of the document in the caller's input `documents` array. */
  index: Schema.Int,
  /** Provider relevance score for the query; higher is more relevant. */
  relevanceScore: Schema.Finite,
}) {}

/**
 * Response for one rerank request. `results` is sorted by descending
 * `relevanceScore` and contains at most `topN` entries when it was set.
 */
// Public surface of the reranker abstraction.
export class RerankResponse extends Schema.Class<RerankResponse>("RerankerModel/RerankResponse")({
  results: Schema.Array(RerankedDocument),
  usage: RerankerUsage,
}) {}

/** Caller-facing input options for a rerank request. */
export interface RerankOptions {
  /** The query to rank the documents against. */
  readonly query: string;
  /** Candidate documents, referenced by index in the results. */
  readonly documents: ReadonlyArray<string>;
  /** Return at most this many results (all documents when omitted). */
  readonly topN?: number | undefined;
}

/** Provider input options for rerank requests. */
export interface ProviderOptions {
  readonly query: string;
  readonly documents: ReadonlyArray<string>;
  readonly topN: number | undefined;
}

/** Provider response contract consumed by {@link make}. */
export interface ProviderResponse {
  readonly results: ReadonlyArray<{
    readonly index: number;
    readonly relevanceScore: number;
  }>;
  readonly usage: { readonly inputTokens: number | undefined };
}

/** Defines the service interface for reranker operations. */
export interface Service {
  readonly rerank: (options: RerankOptions) => Effect.Effect<RerankResponse, AiError.AiError>;
}

const invalidProviderResponse = (description: string): AiError.AiError =>
  AiError.make({
    module: "RerankerModel",
    method: "rerank",
    reason: new AiError.InvalidOutputError({ description }),
  });

const emptyResponse = (): RerankResponse =>
  new RerankResponse({
    results: [],
    usage: new RerankerUsage({ inputTokens: undefined }),
  });

/**
 * Validates a provider response against the request it answered and
 * normalises it to a {@link RerankResponse} sorted by descending
 * relevance.
 */
const mapProviderResponse = (
  documentCount: number,
  topN: number | undefined,
  response: ProviderResponse,
): Effect.Effect<RerankResponse, AiError.AiError> => {
  const limit = topN === undefined ? documentCount : Math.min(topN, documentCount);
  if (response.results.length > limit) {
    return Effect.fail(
      invalidProviderResponse(
        `Provider returned ${response.results.length} results but at most ${limit} were requested`,
      ),
    );
  }
  const seen = new Set<number>();
  for (const result of response.results) {
    if (!Number.isInteger(result.index) || result.index < 0 || result.index >= documentCount) {
      return Effect.fail(
        invalidProviderResponse(
          `Provider returned document index ${result.index}, expected an integer between 0 and ${documentCount - 1}`,
        ),
      );
    }
    if (seen.has(result.index)) {
      return Effect.fail(
        invalidProviderResponse(`Provider returned duplicate document index ${result.index}`),
      );
    }
    seen.add(result.index);
  }
  const results = response.results
    .map(
      (result) =>
        new RerankedDocument({ index: result.index, relevanceScore: result.relevanceScore }),
    )
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
  return Effect.succeed(
    new RerankResponse({
      results,
      usage: new RerankerUsage({ inputTokens: response.usage.inputTokens }),
    }),
  );
};

/**
 * Creates a `RerankerModel` service from a provider rerank
 * implementation — the analogue of `EmbeddingModel.make`.
 *
 * Provider results are interpreted against the request: every `index`
 * must identify an input document, indices must be unique, and the
 * result count must not exceed `topN` (or the document count when
 * `topN` is unset). Violations fail with `AiError.InvalidOutputError`.
 * `rerank` with no documents returns an empty response without calling
 * the provider.
 */
export const make = (params: {
  readonly rerank: (options: ProviderOptions) => Effect.Effect<ProviderResponse, AiError.AiError>;
}): Effect.Effect<Service> =>
  Effect.sync(() =>
    RerankerModel.of({
      rerank: (options) =>
        (options.documents.length === 0
          ? Effect.succeed(emptyResponse())
          : params
              .rerank({
                query: options.query,
                documents: options.documents,
                topN: options.topN,
              })
              .pipe(
                Effect.flatMap((response) =>
                  mapProviderResponse(options.documents.length, options.topN, response),
                ),
              )
        ).pipe(Effect.withSpan("RerankerModel.rerank")),
    }),
  );
