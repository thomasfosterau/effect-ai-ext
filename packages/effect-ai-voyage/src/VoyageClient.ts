/**
 * @copyright Thomas Foster
 *
 * `VoyageClient` — the low-level Effect service for Voyage AI's
 * `/v1/embeddings` and `/v1/rerank` endpoints. It wraps an `HttpClient` with
 * base-URL prefixing and bearer authentication, then exposes one call per
 * endpoint, each mapping every failure into the unified `AiError` type.
 * `VoyageEmbeddingModel` and `VoyageRerankerModel` are built on top of it.
 *
 * There is no `@effect/ai-voyage` package to repoint, so — like this repo's
 * Mistral client — the wire format is decoded directly here against the
 * schemas in `internal/wire`. The `apiUrl` override is a contract, not a
 * convenience: a routing layer (the Cloudflare AI Gateway) repoints the
 * client through it for BYOK.
 *
 * @module VoyageClient
 */

import type * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import type * as AiError from "effect/unstable/ai/AiError";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as Errors from "./internal/errors";
import * as Wire from "./internal/wire";

/** The default Voyage AI API base URL. */
export const defaultApiUrl = "https://api.voyageai.com";

/** The embeddings endpoint path, appended to the base URL. */
const EMBEDDINGS_PATH = "/v1/embeddings";

/** The rerank endpoint path, appended to the base URL. */
const RERANK_PATH = "/v1/rerank";

// =============================================================================
// Service Interface
// =============================================================================

/**
 * The Voyage client service. Both methods surface only `AiError` on the
 * error channel, so consumers never handle transport- or schema-level
 * failures directly.
 */
export interface Service {
  /**
   * Requests embeddings for one or more inputs, returning the decoded body
   * paired with the raw HTTP response (the latter carries request details
   * used to annotate response metadata).
   */
  readonly createEmbeddings: (
    request: Wire.EmbeddingRequest,
  ) => Effect.Effect<
    readonly [body: Wire.EmbeddingResponse, response: HttpClientResponse.HttpClientResponse],
    AiError.AiError
  >;

  /**
   * Reranks documents against a query, returning the decoded body paired
   * with the raw HTTP response.
   */
  readonly createRerank: (
    request: Wire.RerankRequest,
  ) => Effect.Effect<
    readonly [body: Wire.RerankResponse, response: HttpClientResponse.HttpClientResponse],
    AiError.AiError
  >;
}

/**
 * Service tag for the Voyage client.
 *
 * @see {@link make} for constructing the client effectfully
 * @see {@link layer} for providing it from explicit options
 * @see {@link layerConfig} for providing it from `Config`
 */
export class VoyageClient extends Context.Service<VoyageClient, Service>()(
  "@thomasfosterau/effect-ai-voyage/VoyageClient",
) {}

// =============================================================================
// Options
// =============================================================================

/** Configuration for constructing a {@link VoyageClient}. */
export interface Options {
  /**
   * The Voyage API key. Sent as a bearer token. Omit for proxied setups
   * (e.g. a gateway that injects the credential) or tests — requests then
   * carry no `authorization` header.
   */
  readonly apiKey?: Redacted.Redacted<string> | undefined;
  /**
   * The base URL for the API. Override to target a proxy or a routing layer
   * (the Cloudflare AI Gateway repoints the client here for BYOK).
   *
   * @default "https://api.voyageai.com"
   */
  readonly apiUrl?: string | undefined;
  /**
   * Optional transformer for the underlying `HttpClient` (middleware,
   * logging, custom retry, etc.).
   */
  readonly transformClient?: ((client: HttpClient.HttpClient) => HttpClient.HttpClient) | undefined;
}

// =============================================================================
// Constructor
// =============================================================================

/**
 * Constructs a {@link Service} from explicit {@link Options}. Requires an
 * `HttpClient` in context.
 *
 * @see {@link layer} for providing the client as a `Layer`
 * @see {@link layerConfig} for loading settings from `Config`
 */
export const make = Effect.fnUntraced(function* (
  options: Options,
): Effect.fn.Return<Service, never, HttpClient.HttpClient> {
  const baseClient = yield* HttpClient.HttpClient;

  const httpClient = baseClient.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(options.apiUrl ?? defaultApiUrl),
        Predicate.isNotUndefined(options.apiKey)
          ? HttpClientRequest.bearerToken(Redacted.value(options.apiKey))
          : identity,
        HttpClientRequest.acceptJson,
      ),
    ),
    Predicate.isNotUndefined(options.transformClient) ? options.transformClient : identity,
  );

  const httpClientOk = HttpClient.filterStatusOk(httpClient);

  const createEmbeddings: Service["createEmbeddings"] = (request) => {
    const httpRequest = HttpClientRequest.post(EMBEDDINGS_PATH, {
      body: HttpBody.jsonUnsafe(request),
    });
    return httpClientOk.execute(httpRequest).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(Wire.EmbeddingResponse)(response).pipe(
          Effect.map((body) => [body, response] as const),
        ),
      ),
      Effect.catchTags({
        HttpClientError: (error: HttpClientError.HttpClientError) =>
          Errors.mapHttpClientError(error, "createEmbeddings"),
        SchemaError: (error) => Effect.fail(Errors.mapSchemaError(error, "createEmbeddings")),
      }),
    );
  };

  const createRerank: Service["createRerank"] = (request) => {
    const httpRequest = HttpClientRequest.post(RERANK_PATH, {
      body: HttpBody.jsonUnsafe(request),
    });
    return httpClientOk.execute(httpRequest).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(Wire.RerankResponse)(response).pipe(
          Effect.map((body) => [body, response] as const),
        ),
      ),
      Effect.catchTags({
        HttpClientError: (error: HttpClientError.HttpClientError) =>
          Errors.mapHttpClientError(error, "createRerank"),
        SchemaError: (error) => Effect.fail(Errors.mapSchemaError(error, "createRerank")),
      }),
    );
  };

  return VoyageClient.of({ createEmbeddings, createRerank });
});

// =============================================================================
// Layers
// =============================================================================

/**
 * Provides {@link VoyageClient} as a `Layer` from explicit {@link Options}.
 */
export const layer = (options: Options): Layer.Layer<VoyageClient, never, HttpClient.HttpClient> =>
  Layer.effect(VoyageClient, make(options));

/**
 * Provides {@link VoyageClient} as a `Layer`, loading its settings through
 * Effect's `Config` module (e.g. from environment variables or a secrets
 * provider).
 */
export const layerConfig = (options?: {
  readonly apiKey?: Config.Config<Redacted.Redacted<string> | undefined> | undefined;
  readonly apiUrl?: Config.Config<string> | undefined;
  readonly transformClient?: ((client: HttpClient.HttpClient) => HttpClient.HttpClient) | undefined;
}): Layer.Layer<VoyageClient, Config.ConfigError, HttpClient.HttpClient> =>
  Layer.effect(
    VoyageClient,
    Effect.gen(function* () {
      const apiKey = Predicate.isNotUndefined(options?.apiKey) ? yield* options.apiKey : undefined;
      const apiUrl = Predicate.isNotUndefined(options?.apiUrl) ? yield* options.apiUrl : undefined;
      return yield* make({ apiKey, apiUrl, transformClient: options?.transformClient });
    }),
  );
