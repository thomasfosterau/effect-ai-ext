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
 * `makeCohereEmbeddingModelFromUrl` is the binding-free sibling —
 * `Url.ts`'s config-resolved public HTTPS endpoint instead of the Worker
 * binding, for callers (a local CLI, a plain Node process, CI) with no
 * `AI` binding to ask.
 *
 * @module Cohere
 */

import type * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AiError, EmbeddingModel } from "effect/unstable/ai";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { gatewayRun, type GatewayBinding } from "./Binding";
import * as RerankerModel from "./RerankerModel";
import * as Url from "./Url";

/** The AI Gateway provider slug for Cohere (`AIGatewayProviders["cohere"]`). */
const COHERE_PROVIDER: AIGatewayProviders = "cohere";

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

const failure = (method: string, reason: AiError.AiErrorReason): AiError.AiError =>
  AiError.make({ module: "Cohere", method, reason });

/**
 * A response normalised to the shape both {@link cohereRequest} (the
 * Worker-binding transport, a raw `fetch` `Response`) and
 * {@link cohereRequestFromUrl} (the `HttpClient` transport, an
 * `HttpClientResponse`) can produce, so the status/body/schema decode
 * pipeline below is written once and shared by both. Each transport maps
 * its own failure modes into these two Effects at construction time —
 * `text` is best-effort (never fails; falls back to `""`) since it's used
 * only for an error-body description, and `json` already carries the
 * `AiError` this module reports for a body-read failure.
 */
interface NormalizedResponse {
  readonly status: number;
  readonly text: Effect.Effect<string>;
  readonly json: Effect.Effect<unknown, AiError.AiError>;
}

/**
 * Runs a transport call producing a {@link NormalizedResponse} and decodes
 * it against a schema, shared by {@link cohereRequest} and
 * {@link cohereRequestFromUrl} (which differ only in how they obtain and
 * normalise the response). A rejected transport call maps to
 * `UnknownError`; non-2xx statuses map through
 * `AiError.reasonFromHttpStatus`; undecodable bodies map to
 * `InvalidOutputError` — the same posture `packages/ai`'s Voyage client
 * used for the direct API it's replacing.
 */
const decodeCohereResponse = <S extends Schema.Top>(
  response: Effect.Effect<NormalizedResponse, AiError.AiError>,
  schema: S,
  method: string,
): Effect.Effect<S["Type"], AiError.AiError, S["DecodingServices"]> =>
  response.pipe(
    Effect.flatMap((res) =>
      res.status >= 200 && res.status < 300
        ? Effect.succeed(res)
        : res.text.pipe(
            Effect.flatMap((body) =>
              Effect.fail(
                failure(
                  method,
                  AiError.reasonFromHttpStatus({ status: res.status, description: body }),
                ),
              ),
            ),
          ),
    ),
    Effect.flatMap((res) => res.json),
    Effect.flatMap((json) =>
      Schema.decodeUnknownEffect(schema)(json).pipe(
        Effect.mapError((error) =>
          failure(
            method,
            new AiError.InvalidOutputError({
              description: `Cohere ${method} response did not match the expected shape: ${String(error)}`,
            }),
          ),
        ),
      ),
    ),
  );

/** Wraps a body-read failure (JSON parse, stream error) as the shared `UnknownError` shape. */
const bodyReadFailure = (method: string, cause: unknown): AiError.AiError =>
  failure(
    method,
    new AiError.UnknownError({ description: `Cohere ${method} response body: ${String(cause)}` }),
  );

/**
 * Runs one Cohere v2 endpoint through the gateway's Worker-binding
 * universal `run()` endpoint and decodes the JSON response against a
 * schema, via {@link decodeCohereResponse}.
 */
const cohereRequest = <S extends Schema.Top>(
  binding: GatewayBinding,
  endpoint: string,
  query: unknown,
  schema: S,
  method: string,
): Effect.Effect<S["Type"], AiError.AiError, S["DecodingServices"]> =>
  decodeCohereResponse(
    gatewayRun(binding, {
      provider: COHERE_PROVIDER,
      endpoint,
      headers: { "content-type": "application/json" },
      query,
    }).pipe(
      Effect.mapError((cause) =>
        failure(
          method,
          new AiError.UnknownError({
            description: `Cohere ${method} gateway call failed: ${String(cause)}`,
          }),
        ),
      ),
      Effect.map(
        (response): NormalizedResponse => ({
          status: response.status,
          text: Effect.tryPromise(() => response.text()).pipe(Effect.orElseSucceed(() => "")),
          json: Effect.tryPromise({
            try: () => response.json() as Promise<unknown>,
            catch: (cause) => bodyReadFailure(method, cause),
          }),
        }),
      ),
    ),
    schema,
    method,
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

/**
 * Builds an `EmbeddingModel.Service` backed by Cohere `embed-v4.0` over the
 * gateway. `inputType` sets Cohere's retrieval-aware input type — embed
 * stored documents with `"search_document"` and search queries with
 * `"search_query"`.
 */
export const makeCohereEmbeddingModel = (
  binding: GatewayBinding,
  options: { readonly inputType: "search_document" | "search_query" },
): Effect.Effect<EmbeddingModel.Service> =>
  EmbeddingModel.make({
    embedMany: ({ inputs }) =>
      cohereRequest(
        binding,
        "v2/embed",
        {
          model: COHERE_EMBEDDING_MODEL,
          input_type: options.inputType,
          texts: inputs,
          output_dimension: COHERE_EMBEDDING_DIMENSIONS,
          embedding_types: ["float"],
        },
        CohereEmbedResponse,
        "embedMany",
      ).pipe(
        Effect.map((response) => ({
          results: response.embeddings.float.map((vector) => [...vector]),
          usage: { inputTokens: response.meta?.billed_units?.input_tokens },
        })),
      ),
  });

/**
 * Runs one Cohere v2 endpoint through the gateway's **public HTTPS
 * endpoint** (unlike {@link cohereRequest}, which goes through the Worker
 * binding's `run()` universal endpoint) and decodes the JSON response
 * against a schema, via {@link decodeCohereResponse}. Takes an
 * already-resolved `HttpClient.HttpClient` plus the precomputed base URL
 * and `cf-aig-authorization` header so the caller
 * (`makeCohereEmbeddingModelFromUrl`) builds them once at construction
 * time, not on every request.
 *
 * Goes through Effect's `HttpClient`/`FetchHttpClient`, which is already
 * interruption-safe (the #706/#730 lesson `Binding.ts`'s `gatewayRun`
 * applies manually via a declared `signal` — see
 * docs/decisions/effect-ai-gateway.md) — no manual signal plumbing needed
 * here.
 */
const cohereRequestFromUrl = <S extends Schema.Top>(
  httpClient: HttpClient.HttpClient,
  baseUrl: string,
  authHeader: Record<string, string>,
  endpoint: string,
  query: unknown,
  schema: S,
  method: string,
): Effect.Effect<S["Type"], AiError.AiError, S["DecodingServices"]> => {
  const request = HttpClientRequest.post(`${baseUrl}/${endpoint}`, {
    body: HttpBody.jsonUnsafe(query),
  }).pipe(HttpClientRequest.setHeaders(authHeader));

  return decodeCohereResponse(
    httpClient.execute(request).pipe(
      Effect.mapError((cause) =>
        failure(
          method,
          new AiError.UnknownError({
            description: `Cohere ${method} gateway call failed: ${String(cause)}`,
          }),
        ),
      ),
      Effect.map(
        (response): NormalizedResponse => ({
          status: response.status,
          text: response.text.pipe(Effect.orElseSucceed(() => "")),
          json: response.json.pipe(Effect.mapError((cause) => bodyReadFailure(method, cause))),
        }),
      ),
    ),
    schema,
    method,
  );
};

/**
 * Builds an `EmbeddingModel.Service` backed by Cohere `embed-v4.0` over the
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
export const makeCohereEmbeddingModelFromUrl = (options: {
  readonly inputType: "search_document" | "search_query";
}): Effect.Effect<EmbeddingModel.Service, Config.ConfigError> =>
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
          {
            model: COHERE_EMBEDDING_MODEL,
            input_type: options.inputType,
            texts: inputs,
            output_dimension: COHERE_EMBEDDING_DIMENSIONS,
            embedding_types: ["float"],
          },
          CohereEmbedResponse,
          "embedMany",
        ).pipe(
          Effect.map((response) => ({
            results: response.embeddings.float.map((vector) => [...vector]),
            usage: { inputTokens: response.meta?.billed_units?.input_tokens },
          })),
        ),
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

/** Builds a `RerankerModel.Service` backed by Cohere `rerank-v3.5` over the gateway. */
export const makeCohereReranker = (binding: GatewayBinding): Effect.Effect<RerankerModel.Service> =>
  RerankerModel.make({
    rerank: ({ query, documents, topN }) =>
      cohereRequest(
        binding,
        "v2/rerank",
        {
          model: COHERE_RERANK_MODEL,
          query,
          documents,
          ...(topN !== undefined && { top_n: topN }),
        },
        CohereRerankResponse,
        "rerank",
      ).pipe(
        Effect.map((response) => ({
          results: response.results.map((entry) => ({
            index: entry.index,
            relevanceScore: entry.relevance_score,
          })),
          usage: { inputTokens: response.meta?.billed_units?.search_units },
        })),
      ),
  });
