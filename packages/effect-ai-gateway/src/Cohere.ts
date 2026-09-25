/**
 * @copyright Thomas Foster
 *
 * Cohere `EmbeddingModel` and `RerankerModel` providers routed through the
 * Cloudflare AI Gateway Worker binding (docs/decisions/effect-ai-gateway.md),
 * replacing the dormant Voyage client. The provider key is BYOK, configured
 * once on the `website` gateway (Cloudflare dashboard, provider keys) —
 * never an env var, so this module never takes or reads an API key.
 *
 * Unlike `Anthropic.ts` (which repoints `@effect/ai-anthropic`'s existing
 * client at the gateway), Cohere has no `@effect/ai-*` package to repoint —
 * both services are built directly on `Binding.ts`'s `gatewayRun` universal
 * endpoint, decoding Cohere's native v2 wire format.
 *
 * `makeCohereEmbeddingModelFromUrl` and `makeCohereRerankerFromUrl` are the
 * binding-free siblings — `Url.ts`'s config-resolved public HTTPS endpoint
 * instead of the Worker binding, for callers (a local CLI, a plain Node
 * process, CI) with no `AI` binding to ask. Both pairs share one request
 * body and one response mapping, so the two transports cannot drift.
 *
 * @module Cohere
 */

import type * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { AiError } from "effect/unstable/ai";
import { EmbeddingModel } from "effect/unstable/ai";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import type { GatewayBinding } from "./Binding";
import { requestViaBinding, requestViaUrl } from "./internal/transport";
import * as RerankerModel from "./RerankerModel";
import * as Url from "./Url";

/** The AI Gateway provider slug for Cohere (`AIGatewayProviders["cohere"]`). */
const COHERE_PROVIDER: AIGatewayProviders = "cohere";

/** `AiError.module` for every failure this module reports. */
const MODULE = "Cohere";

/** Cohere's embedding model. A single constant so rotation is one edit. */
export const COHERE_EMBEDDING_MODEL = "embed-v4.0";

/** Cohere's reranker model. A single constant so rotation is one edit. */
export const COHERE_RERANK_MODEL = "rerank-v3.5";

/**
 * embed-v4's output dimension, pinned explicitly on every request rather
 * than trusting the model's default (1536) — must match `packages/database`'s
 * `EMBEDDING_DIMENSIONS`, the `vector(n)` columns' actual source of truth.
 * Kept as an independent literal (not imported from `@thomasfosterau/database`)
 * because this package stays app-schema-agnostic; a dedicated test pins the
 * two constants equal — see `tests/cohere.test.ts`.
 */
export const COHERE_EMBEDDING_DIMENSIONS = 1024;

/**
 * Runs one Cohere v2 endpoint through the gateway's Worker-binding
 * universal `run()` endpoint and decodes the JSON response against a
 * schema (`internal/transport.ts`).
 */
const cohereRequest = <S extends Schema.Top>(
  binding: GatewayBinding,
  endpoint: string,
  query: unknown,
  schema: S,
  method: string,
): Effect.Effect<S["Type"], AiError.AiError, S["DecodingServices"]> =>
  requestViaBinding(
    { module: MODULE, method },
    binding,
    { provider: COHERE_PROVIDER, endpoint, headers: { "content-type": "application/json" }, query },
    schema,
  );

/**
 * Runs one Cohere v2 endpoint through the gateway's public HTTPS endpoint
 * (`Url.ts`) over an already-resolved `HttpClient.HttpClient` and decodes
 * the JSON response against a schema (`internal/transport.ts`). Takes the
 * precomputed base URL and `cf-aig-authorization` header so the caller
 * builds them once at construction time, not on every request.
 */
const cohereRequestFromUrl = <S extends Schema.Top>(
  httpClient: HttpClient.HttpClient,
  baseUrl: string,
  authHeader: Record<string, string>,
  endpoint: string,
  query: unknown,
  schema: S,
  method: string,
): Effect.Effect<S["Type"], AiError.AiError, S["DecodingServices"]> =>
  requestViaUrl(
    { module: MODULE, method },
    httpClient,
    `${baseUrl}/${endpoint}`,
    authHeader,
    query,
    schema,
  );

// ── Embeddings ────────────────────────────────────────────────────────

const CohereEmbedResponse = Schema.Struct({
  embeddings: Schema.Struct({
    float: Schema.Array(Schema.Array(Schema.Finite)),
  }),
  meta: Schema.optional(
    Schema.Struct({
      billed_units: Schema.optional(
        Schema.Struct({ input_tokens: Schema.optional(Schema.Finite) }),
      ),
    }),
  ),
});

/** Caller options shared by both embedding transports. */
export interface CohereEmbeddingOptions {
  /**
   * Cohere's retrieval-aware input type — embed stored documents with
   * `"search_document"` and search queries with `"search_query"`.
   */
  readonly inputType: "search_document" | "search_query";
}

/** The `v2/embed` request body, identical on both transports. */
const embedQuery = (options: CohereEmbeddingOptions, inputs: ReadonlyArray<string>) => ({
  model: COHERE_EMBEDDING_MODEL,
  input_type: options.inputType,
  texts: inputs,
  output_dimension: COHERE_EMBEDDING_DIMENSIONS,
  embedding_types: ["float"],
});

/** Maps a decoded `v2/embed` response onto `EmbeddingModel`'s provider contract. */
const mapEmbedResponse = (response: typeof CohereEmbedResponse.Type) => ({
  results: response.embeddings.float.map((vector) => [...vector]),
  usage: { inputTokens: response.meta?.billed_units?.input_tokens },
});

/**
 * Builds an `EmbeddingModel` service backed by Cohere `embed-v4.0` over the
 * gateway. `inputType` sets Cohere's retrieval-aware input type — embed
 * stored documents with `"search_document"` and search queries with
 * `"search_query"`.
 */
export const makeCohereEmbeddingModel = (
  binding: GatewayBinding,
  options: CohereEmbeddingOptions,
): Effect.Effect<EmbeddingModel.EmbeddingModel> =>
  EmbeddingModel.make({
    embedMany: ({ inputs }) =>
      cohereRequest(
        binding,
        "v2/embed",
        embedQuery(options, inputs),
        CohereEmbedResponse,
        "embedMany",
      ).pipe(Effect.map(mapEmbedResponse)),
  });

/**
 * Builds an `EmbeddingModel` service backed by Cohere `embed-v4.0` over the
 * AI Gateway's **public HTTPS endpoint** — the binding-free sibling of
 * {@link makeCohereEmbeddingModel}, usable from a plain Node process, a
 * local CLI, or CI. `inputType` sets Cohere's retrieval-aware input type,
 * same as the binding-based variant.
 *
 * Config (`CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`, `CF_AIG_TOKEN`) is loaded
 * via `Url.gatewayUrlConfig`; a missing required value fails with a typed
 * `Config.ConfigError`. Provides `FetchHttpClient` internally, so the
 * returned effect carries no `HttpClient` (or Worker binding) requirement.
 */
export const makeCohereEmbeddingModelFromUrl = (
  options: CohereEmbeddingOptions,
): Effect.Effect<EmbeddingModel.EmbeddingModel, Config.ConfigError> =>
  Effect.gen(function* () {
    const gatewayConfig = yield* Url.gatewayUrlConfig;
    const httpClient = yield* HttpClient.HttpClient;
    const baseUrl = Url.gatewayBaseUrl(gatewayConfig, COHERE_PROVIDER);
    const authHeader = Url.cfAigAuthorizationHeader(gatewayConfig);

    return yield* EmbeddingModel.make({
      embedMany: ({ inputs }) =>
        cohereRequestFromUrl(
          httpClient,
          baseUrl,
          authHeader,
          "v2/embed",
          embedQuery(options, inputs),
          CohereEmbedResponse,
          "embedMany",
        ).pipe(Effect.map(mapEmbedResponse)),
    });
  }).pipe(Effect.provide(FetchHttpClient.layer));

// ── Reranking ─────────────────────────────────────────────────────────

const CohereRerankResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      index: Schema.Int,
      relevance_score: Schema.Finite,
    }),
  ),
  meta: Schema.optional(
    Schema.Struct({
      billed_units: Schema.optional(
        Schema.Struct({ search_units: Schema.optional(Schema.Finite) }),
      ),
    }),
  ),
});

/** The `v2/rerank` request body, identical on both transports. */
const rerankQuery = ({ query, documents, topN }: RerankerModel.ProviderOptions) => ({
  model: COHERE_RERANK_MODEL,
  query,
  documents,
  ...(topN !== undefined && { top_n: topN }),
});

/** Maps a decoded `v2/rerank` response onto `RerankerModel`'s provider contract. */
const mapRerankResponse = (
  response: typeof CohereRerankResponse.Type,
): RerankerModel.ProviderResponse => ({
  results: response.results.map((entry) => ({
    index: entry.index,
    relevanceScore: entry.relevance_score,
  })),
  usage: { inputTokens: response.meta?.billed_units?.search_units },
});

/** Builds a `RerankerModel.Service` backed by Cohere `rerank-v3.5` over the gateway. */
export const makeCohereReranker = (binding: GatewayBinding): Effect.Effect<RerankerModel.Service> =>
  RerankerModel.make({
    rerank: (options) =>
      cohereRequest(
        binding,
        "v2/rerank",
        rerankQuery(options),
        CohereRerankResponse,
        "rerank",
      ).pipe(Effect.map(mapRerankResponse)),
  });

/**
 * Builds a `RerankerModel.Service` backed by Cohere `rerank-v3.5` over the
 * AI Gateway's **public HTTPS endpoint** — the binding-free sibling of
 * {@link makeCohereReranker}, usable from a plain Node process, a local
 * CLI, or CI (an offline evaluation harness, say).
 *
 * Config (`CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`, `CF_AIG_TOKEN`) is resolved
 * **once at construction**, not per request — the base URL and the auth
 * header are pure string work over values that cannot change mid-run, and
 * re-deriving them per case of a two-hundred-case evaluation would be a
 * config read in a loop. A missing required value fails with a typed
 * `Config.ConfigError`. Provides `FetchHttpClient` internally, so the effect
 * carries no `HttpClient` (or Worker binding) requirement. Takes no options,
 * so it is a plain (lazy) Effect value rather than a zero-argument
 * constructor: `const reranker = yield* makeCohereRerankerFromUrl`.
 */
export const makeCohereRerankerFromUrl: Effect.Effect<
  RerankerModel.Service,
  Config.ConfigError
> = Effect.gen(function* () {
    const gatewayConfig = yield* Url.gatewayUrlConfig;
    const httpClient = yield* HttpClient.HttpClient;
    const baseUrl = Url.gatewayBaseUrl(gatewayConfig, COHERE_PROVIDER);
    const authHeader = Url.cfAigAuthorizationHeader(gatewayConfig);

    return yield* RerankerModel.make({
      rerank: (options) =>
        cohereRequestFromUrl(
          httpClient,
          baseUrl,
          authHeader,
          "v2/rerank",
          rerankQuery(options),
          CohereRerankResponse,
          "rerank",
        ).pipe(Effect.map(mapRerankResponse)),
    });
  }).pipe(Effect.provide(FetchHttpClient.layer));
