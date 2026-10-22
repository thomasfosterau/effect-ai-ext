/**
 * Defines the provider-neutral service for reranking documents.
 *
 * A `RerankerModel` scores and reorders candidate documents against a query —
 * the sibling of `LanguageModel` and `EmbeddingModel` from `effect/ai`
 * (which has no reranker module yet). This module also includes the response
 * and usage models, provider contracts, and a constructor that adapts a
 * provider rerank implementation into the service.
 *
 * The shape deliberately mirrors `EmbeddingModel`: providers supply one
 * `rerank` function through {@link make}, provider results are validated (every
 * index in range, no duplicates, no more results than requested) and normalised
 * to descending relevance order, and provider failures stay represented as
 * `AiError` values.
 *
 * **Gotchas**
 *
 * - `rerank` with an empty `documents` array returns an empty response without
 *   invoking the provider.
 * - Result `index` values refer to positions in the caller's input `documents`
 *   array; results are returned sorted by descending `relevanceScore`
 *   regardless of provider ordering.
 */

import * as Order from "effect/Order";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AiError } from "effect/ai";

/**
 * Service tag for reranker model operations.
 *
 * **When to use**
 *
 * Use to retrieve or provide the reranker model service for an `Effect` program
 * that reorders documents by relevance to a query.
 *
 * @see {@link Service} for the service contract provided by this tag
 * @see {@link make} for constructing a reranker model service from a provider
 *
 * @category services
 */
export class RerankerModel extends Context.Service<RerankerModel, Service>()(
  "@thomasfosterau/effect-ai-ext/RerankerModel",
) {}

/**
 * Represents token usage metadata for a rerank operation.
 *
 * **Details**
 *
 * `inputTokens` is `undefined` when the provider does not report usage or when
 * the empty input short-circuit bypassed the provider.
 *
 * @category models
 */
export class RerankerUsage extends Schema.Class<RerankerUsage>(
  "@thomasfosterau/effect-ai-ext/RerankerModel/RerankerUsage",
)({
  inputTokens: Schema.UndefinedOr(Schema.Finite),
}) {}

/**
 * One reranked document: its position in the caller's input plus the provider's
 * relevance score.
 *
 * @category models
 */
export class RerankedDocument extends Schema.Class<RerankedDocument>(
  "@thomasfosterau/effect-ai-ext/RerankerModel/RerankedDocument",
)({
  /** Index of the document in the caller's input `documents` array. */
  index: Schema.Int,
  /** Provider relevance score for the query; higher is more relevant. */
  relevanceScore: Schema.Finite,
}) {}

/**
 * Response for one rerank request.
 *
 * **Details**
 *
 * `results` is sorted by descending `relevanceScore` and contains at most
 * `topN` entries when it was set.
 *
 * @see {@link RerankedDocument} for individual reranked documents
 * @see {@link RerankerUsage} for token usage metadata
 *
 * @category models
 */
export class RerankResponse extends Schema.Class<RerankResponse>(
  "@thomasfosterau/effect-ai-ext/RerankerModel/RerankResponse",
)({
  results: Schema.Array(RerankedDocument),
  usage: RerankerUsage,
}) {}

/**
 * Caller-facing input options for a rerank request.
 *
 * @category options
 */
export interface RerankOptions {
  /** The query to rank the documents against. */
  readonly query: string;
  /** Candidate documents, referenced by index in the results. */
  readonly documents: ReadonlyArray<string>;
  /** Return at most this many results (all documents when omitted). */
  readonly topN?: number | undefined;
}

/**
 * Provider input options for rerank requests.
 *
 * @category options
 */
export interface ProviderOptions {
  readonly query: string;
  readonly documents: ReadonlyArray<string>;
  readonly topN: number | undefined;
}

/**
 * Provider response contract consumed by {@link make}.
 *
 * @category models
 */
export interface ProviderResponse {
  readonly results: ReadonlyArray<{
    readonly index: number;
    readonly relevanceScore: number;
  }>;
  readonly usage: { readonly inputTokens: number | undefined };
}

/**
 * Defines the service interface for reranker operations.
 *
 * @category models
 */
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

/** Most relevant document first. */
const byRelevanceDescending: Order.Order<RerankedDocument> = Order.flip(
  Order.mapInput(Order.Number, (document: RerankedDocument) => document.relevanceScore),
);

/**
 * Validates a provider response against the request it answered and normalises
 * it to a {@link RerankResponse} sorted by descending relevance.
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
  const invalid = Arr.findFirst(response.results, (result, i) =>
    !Number.isInteger(result.index) || result.index < 0 || result.index >= documentCount
      ? Option.some(
          `Provider returned document index ${result.index}, expected an integer between 0 and ${documentCount - 1}`,
        )
      : Arr.some(Arr.take(response.results, i), (earlier) => earlier.index === result.index)
        ? Option.some(`Provider returned duplicate document index ${result.index}`)
        : Option.none(),
  );
  if (Option.isSome(invalid)) {
    return Effect.fail(invalidProviderResponse(invalid.value));
  }
  const results = Arr.sort(
    response.results.map(
      (result) =>
        new RerankedDocument({ index: result.index, relevanceScore: result.relevanceScore }),
    ),
    byRelevanceDescending,
  );
  return Effect.succeed(
    new RerankResponse({
      results,
      usage: new RerankerUsage({ inputTokens: response.usage.inputTokens }),
    }),
  );
};

/**
 * Creates a `RerankerModel` service from a provider rerank implementation — the
 * analogue of `EmbeddingModel.make`.
 *
 * **Details**
 *
 * Provider results are interpreted against the request: every `index` must
 * identify an input document, indices must be unique, and the result count must
 * not exceed `topN` (or the document count when `topN` is unset). Violations
 * fail with `AiError.InvalidOutputError`. `rerank` with no documents returns an
 * empty response without calling the provider.
 *
 * @see {@link Service} for the service shape returned by this constructor
 * @see {@link ProviderOptions} for the input passed to the provider implementation
 * @see {@link ProviderResponse} for the provider response contract consumed by this constructor
 *
 * @category constructors
 */
export const make = (params: {
  readonly rerank: (options: ProviderOptions) => Effect.Effect<ProviderResponse, AiError.AiError>;
}): Effect.Effect<Service> =>
  Effect.sync(() =>
    RerankerModel.of({
      rerank: (options) =>
        (Arr.isReadonlyArrayEmpty(options.documents)
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
