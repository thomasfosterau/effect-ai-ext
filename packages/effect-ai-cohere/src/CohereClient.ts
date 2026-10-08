/**
 * `CohereClient` — the low-level Effect service for Cohere's v2 API. It wraps
 * an `HttpClient` with base-URL prefixing and bearer authentication, then
 * exposes the four endpoints this provider speaks — `/v2/chat` (regular and
 * streaming), `/v2/embed`, and `/v2/rerank` — each mapping every failure into
 * the unified `AiError` type. The higher-level models
 * ({@link CohereLanguageModel}, {@link CohereEmbeddingModel},
 * {@link CohereRerankerModel}, {@link CohereClassifierModel}) are built on top
 * of it.
 *
 * There is no `@effect/ai-cohere` package to repoint (unlike Anthropic), so
 * the wire format is decoded directly here against the schemas in
 * `internal/wire`.
 *
 * The **`apiUrl` override is a contract, not a convenience** — it is how a
 * routing layer (the Cloudflare AI Gateway package) repoints this client at a
 * gateway route for BYOK, in parity with how `@effect/ai-anthropic`'s client
 * gets repointed.
 *
 * @module CohereClient
 *
 * @copyright Thomas Foster
 */

import * as Str from "effect/String";
import type * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as AiError from "effect/ai/AiError";
import * as Sse from "effect/encoding/Sse";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Errors from "./internal/errors";
import * as Wire from "./internal/wire";

/** The default Cohere API base URL. */
export const defaultApiUrl = "https://api.cohere.com";

/** The chat endpoint path, appended to the base URL. */
const CHAT_PATH = "/v2/chat";

/** The embed endpoint path, appended to the base URL. */
const EMBED_PATH = "/v2/embed";

/** The rerank endpoint path, appended to the base URL. */
const RERANK_PATH = "/v2/rerank";

/**
 * The SSE sentinel some transports emit to close a streaming response.
 * Cohere's own stream ends by closing after the `message-end` event rather
 * than sending a sentinel, but filtering `[DONE]` is a harmless guard for
 * proxied setups that inject one.
 */
const STREAM_DONE = "[DONE]";

// =============================================================================
// Service Interface
// =============================================================================

/**
 * The Cohere client service. Every method surfaces only `AiError` on the
 * error channel, so consumers never handle transport- or schema-level
 * failures directly.
 */
export interface Service {
  /**
   * Requests a non-streaming chat completion, returning the decoded body
   * paired with the raw HTTP response (the latter carries request details
   * used to annotate response metadata).
   */
  readonly chat: (
    request: Wire.ChatRequest,
  ) => Effect.Effect<
    readonly [body: Wire.ChatResponse, response: HttpClientResponse.HttpClientResponse],
    AiError.AiError
  >;

  /**
   * Requests a streaming chat completion. The returned effect yields the
   * HTTP response and a stream of decoded SSE events; the stream ends when
   * Cohere closes the connection after its `message-end` event.
   */
  readonly chatStream: (
    request: Wire.ChatRequest,
  ) => Effect.Effect<
    readonly [
      response: HttpClientResponse.HttpClientResponse,
      stream: Stream.Stream<Wire.ChatStreamEvent, AiError.AiError>,
    ],
    AiError.AiError
  >;

  /** Requests text embeddings from `/v2/embed`. */
  readonly embed: (
    request: Wire.EmbedRequest,
  ) => Effect.Effect<Wire.EmbedResponse, AiError.AiError>;

  /** Reranks documents against a query via `/v2/rerank`. */
  readonly rerank: (
    request: Wire.RerankRequest,
  ) => Effect.Effect<Wire.RerankResponse, AiError.AiError>;
}

/**
 * Service tag for the Cohere client.
 *
 * @see {@link make} for constructing the client effectfully
 * @see {@link layer} for providing it from explicit options
 * @see {@link layerConfig} for providing it from `Config`
 */
export class CohereClient extends Context.Service<CohereClient, Service>()(
  "@thomasfosterau/effect-ai-cohere/CohereClient",
) {}

// =============================================================================
// Options
// =============================================================================

/** Configuration for constructing a {@link CohereClient}. */
export interface Options {
  /**
   * The Cohere API key. Sent as a bearer token. Omit for proxied setups
   * (e.g. a gateway that injects the credential) or tests — requests then
   * carry no `authorization` header.
   */
  readonly apiKey?: Redacted.Redacted<string> | undefined;
  /**
   * The base URL for the API. Override to target a proxy or the Cloudflare
   * AI Gateway route (BYOK).
   *
   * @default "https://api.cohere.com"
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

  const chat: Service["chat"] = (request) => {
    const httpRequest = HttpClientRequest.post(CHAT_PATH, {
      body: HttpBody.jsonUnsafe({ ...request, stream: false }),
    });
    return httpClientOk.execute(httpRequest).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(Wire.ChatResponse)(response).pipe(
          Effect.map((body) => [body, response] as const),
        ),
      ),
      Effect.catchTags({
        HttpClientError: (error: HttpClientError.HttpClientError) =>
          Errors.mapHttpClientError(error, "chat"),
        SchemaError: (error) => Effect.fail(Errors.mapSchemaError(error, "chat")),
      }),
    );
  };

  const chatStream: Service["chatStream"] = (request) => {
    const httpRequest = HttpClientRequest.post(CHAT_PATH, {
      body: HttpBody.jsonUnsafe({ ...request, stream: true }),
    });
    return httpClientOk.execute(httpRequest).pipe(
      Effect.map((response) => [response, buildEventStream(response)] as const),
      Effect.catchTag("HttpClientError", (error) => Errors.mapHttpClientError(error, "chatStream")),
    );
  };

  const embed: Service["embed"] = (request) => {
    const httpRequest = HttpClientRequest.post(EMBED_PATH, {
      body: HttpBody.jsonUnsafe(request),
    });
    return httpClientOk.execute(httpRequest).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Wire.EmbedResponse)),
      Effect.catchTags({
        HttpClientError: (error: HttpClientError.HttpClientError) =>
          Errors.mapHttpClientError(error, "embed"),
        SchemaError: (error) => Effect.fail(Errors.mapSchemaError(error, "embed")),
      }),
    );
  };

  const rerank: Service["rerank"] = (request) => {
    const httpRequest = HttpClientRequest.post(RERANK_PATH, {
      body: HttpBody.jsonUnsafe(request),
    });
    return httpClientOk.execute(httpRequest).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Wire.RerankResponse)),
      Effect.catchTags({
        HttpClientError: (error: HttpClientError.HttpClientError) =>
          Errors.mapHttpClientError(error, "rerank"),
        SchemaError: (error) => Effect.fail(Errors.mapSchemaError(error, "rerank")),
      }),
    );
  };

  return CohereClient.of({ chat, chatStream, embed, rerank });
});

/**
 * Turns the raw SSE byte stream into a stream of decoded events: parse SSE
 * frames, drop keep-alive and `[DONE]` frames, JSON-decode each remaining
 * `data` payload against the event schema, and map any transport, SSE framing
 * or schema failure into an `AiError`.
 */
const buildEventStream = (
  response: HttpClientResponse.HttpClientResponse,
): Stream.Stream<Wire.ChatStreamEvent, AiError.AiError> =>
  response.stream.pipe(
    Stream.decodeText,
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.filter((event) => Str.isNonEmpty(event.data) && event.data !== STREAM_DONE),
    Stream.mapEffect((event) =>
      decodeEvent(event.data).pipe(
        Effect.mapError((error) => Errors.mapSchemaError(error, "chatStream")),
      ),
    ),
    Stream.catchTags({
      HttpClientError: (error) => Stream.fromEffect(Errors.mapHttpClientError(error, "chatStream")),
      SseError: (error) => Stream.fail(Errors.mapSseError(error, "chatStream")),
      // SSE reconnection is not supported for chat — an upstream retry directive
      // is a defect, not a recoverable condition.
      Retry: (error) => Stream.die(error),
    }),
  );

/**
 * Parses one SSE `data` payload as JSON and decodes it against the event
 * schema. A non-JSON frame is passed through to the schema decoder as-is, so
 * it surfaces as an ordinary `SchemaError` rather than a thrown parse error.
 */
const decodeEvent = (data: string): Effect.Effect<Wire.ChatStreamEvent, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(Wire.ChatStreamEvent)(Wire.parseJsonLenient(data));

// =============================================================================
// Layers
// =============================================================================

/**
 * Provides {@link CohereClient} as a `Layer` from explicit {@link Options}.
 */
export const layer = (options: Options): Layer.Layer<CohereClient, never, HttpClient.HttpClient> =>
  Layer.effect(CohereClient, make(options));

/**
 * Provides {@link CohereClient} as a `Layer`, loading its settings through
 * Effect's `Config` module (e.g. from environment variables or a secrets
 * provider).
 */
export const layerConfig = (options?: {
  readonly apiKey?: Config.Config<Redacted.Redacted<string> | undefined> | undefined;
  readonly apiUrl?: Config.Config<string> | undefined;
  readonly transformClient?: ((client: HttpClient.HttpClient) => HttpClient.HttpClient) | undefined;
}): Layer.Layer<CohereClient, Config.ConfigError, HttpClient.HttpClient> =>
  Layer.effect(
    CohereClient,
    Effect.gen(function* () {
      const apiKey = Predicate.isNotUndefined(options?.apiKey) ? yield* options.apiKey : undefined;
      const apiUrl = Predicate.isNotUndefined(options?.apiUrl) ? yield* options.apiUrl : undefined;
      return yield* make({ apiKey, apiUrl, transformClient: options?.transformClient });
    }),
  );
