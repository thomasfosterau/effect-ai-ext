/**
 * `MistralClient` — the low-level Effect service for Mistral's
 * `/v1/chat/completions` endpoint. It wraps an `HttpClient` with base-URL
 * prefixing and bearer authentication, then exposes one regular and one
 * streaming call, each mapping every failure into the unified `AiError`
 * type. `MistralLanguageModel` is built on top of it.
 *
 * There is no `@effect/ai-mistral` package to repoint (unlike Anthropic),
 * so — like this repo's Cohere gateway client — the wire format is decoded
 * directly here against the schemas in `internal/wire`. Mistral's API is
 * OpenAI-shaped chat completions, so the same client also serves any
 * OpenAI-compatible endpoint via the `apiUrl` option.
 *
 * @module MistralClient
 *
 * @copyright Thomas Foster
 */

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

/** The default Mistral API base URL. */
export const defaultApiUrl = "https://api.mistral.ai";

/** The chat completions endpoint path, appended to the base URL. */
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

/** The SSE sentinel Mistral emits to close a streaming response. */
const STREAM_DONE = "[DONE]";

// =============================================================================
// Service Interface
// =============================================================================

/**
 * The Mistral client service. Both methods surface only `AiError` on the
 * error channel, so consumers never handle transport- or schema-level
 * failures directly.
 */
export interface Service {
  /**
   * Requests a non-streaming chat completion, returning the decoded body
   * paired with the raw HTTP response (the latter carries request details
   * used to annotate response metadata).
   */
  readonly createChatCompletion: (
    request: Wire.ChatCompletionRequest,
  ) => Effect.Effect<
    readonly [body: Wire.ChatCompletionResponse, response: HttpClientResponse.HttpClientResponse],
    AiError.AiError
  >;

  /**
   * Requests a streaming chat completion. The returned effect yields the
   * HTTP response and a stream of decoded chunks; the stream ends when
   * Mistral sends its `[DONE]` sentinel.
   */
  readonly createChatCompletionStream: (
    request: Wire.ChatCompletionRequest,
  ) => Effect.Effect<
    readonly [
      response: HttpClientResponse.HttpClientResponse,
      stream: Stream.Stream<Wire.ChatCompletionChunk, AiError.AiError>,
    ],
    AiError.AiError
  >;
}

/**
 * Service tag for the Mistral client.
 *
 * @see {@link make} for constructing the client effectfully
 * @see {@link layer} for providing it from explicit options
 * @see {@link layerConfig} for providing it from `Config`
 */
export class MistralClient extends Context.Service<MistralClient, Service>()(
  "@thomasfosterau/effect-ai-mistral/MistralClient",
) {}

// =============================================================================
// Options
// =============================================================================

/** Configuration for constructing a {@link MistralClient}. */
export interface Options {
  /**
   * The Mistral API key. Sent as a bearer token. Omit for proxied setups
   * (e.g. a gateway that injects the credential) or tests — requests then
   * carry no `authorization` header.
   */
  readonly apiKey?: Redacted.Redacted<string> | undefined;
  /**
   * The base URL for the API. Override to target a proxy or another
   * OpenAI-compatible endpoint.
   *
   * @default "https://api.mistral.ai"
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

  const createChatCompletion: Service["createChatCompletion"] = (request) => {
    const httpRequest = HttpClientRequest.post(CHAT_COMPLETIONS_PATH, {
      body: HttpBody.jsonUnsafe({ ...request, stream: false }),
    });
    return httpClientOk.execute(httpRequest).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(Wire.ChatCompletionResponse)(response).pipe(
          Effect.map((body) => [body, response] as const),
        ),
      ),
      Effect.catchTags({
        HttpClientError: (error: HttpClientError.HttpClientError) =>
          Errors.mapHttpClientError(error, "createChatCompletion"),
        SchemaError: (error) => Effect.fail(Errors.mapSchemaError(error, "createChatCompletion")),
      }),
    );
  };

  const createChatCompletionStream: Service["createChatCompletionStream"] = (request) => {
    const httpRequest = HttpClientRequest.post(CHAT_COMPLETIONS_PATH, {
      body: HttpBody.jsonUnsafe({ ...request, stream: true }),
    });
    return httpClientOk.execute(httpRequest).pipe(
      Effect.map((response) => [response, buildChunkStream(response)] as const),
      Effect.catchTag("HttpClientError", (error) =>
        Errors.mapHttpClientError(error, "createChatCompletionStream"),
      ),
    );
  };

  return MistralClient.of({ createChatCompletion, createChatCompletionStream });
});

/**
 * Turns the raw SSE byte stream into a stream of decoded chunks: parse SSE
 * frames, drop the terminal `[DONE]` sentinel, JSON-decode each remaining
 * `data` payload against the chunk schema, and map any transport, SSE framing
 * or schema failure into an `AiError`.
 */
const buildChunkStream = (
  response: HttpClientResponse.HttpClientResponse,
): Stream.Stream<Wire.ChatCompletionChunk, AiError.AiError> =>
  response.stream.pipe(
    Stream.decodeText,
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.takeWhile((event) => event.data !== STREAM_DONE),
    Stream.mapEffect((event) =>
      decodeChunk(event.data).pipe(
        Effect.mapError((error) => Errors.mapSchemaError(error, "createChatCompletionStream")),
      ),
    ),
    Stream.catchTags({
      HttpClientError: (error) =>
        Stream.fromEffect(Errors.mapHttpClientError(error, "createChatCompletionStream")),
      SseError: (error) => Stream.fail(Errors.mapSseError(error, "createChatCompletionStream")),
      // SSE reconnection is not supported for chat completions — an upstream
      // retry directive is a defect, not a recoverable condition.
      Retry: (error) => Stream.die(error),
    }),
  );

/**
 * Parses one SSE `data` payload as JSON and decodes it against the chunk
 * schema. A non-JSON frame is passed through to the schema decoder as-is,
 * so it surfaces as an ordinary `SchemaError` rather than a thrown parse
 * error.
 */
const decodeChunk = (data: string): Effect.Effect<Wire.ChatCompletionChunk, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(Wire.ChatCompletionChunk)(Wire.parseJsonLenient(data));

// =============================================================================
// Layers
// =============================================================================

/**
 * Provides {@link MistralClient} as a `Layer` from explicit {@link Options}.
 */
export const layer = (options: Options): Layer.Layer<MistralClient, never, HttpClient.HttpClient> =>
  Layer.effect(MistralClient, make(options));

/**
 * Provides {@link MistralClient} as a `Layer`, loading its settings through
 * Effect's `Config` module (e.g. from environment variables or a secrets
 * provider).
 */
export const layerConfig = (options?: {
  readonly apiKey?: Config.Config<Redacted.Redacted<string> | undefined> | undefined;
  readonly apiUrl?: Config.Config<string> | undefined;
  readonly transformClient?: ((client: HttpClient.HttpClient) => HttpClient.HttpClient) | undefined;
}): Layer.Layer<MistralClient, Config.ConfigError, HttpClient.HttpClient> =>
  Layer.effect(
    MistralClient,
    Effect.gen(function* () {
      const apiKey = Predicate.isNotUndefined(options?.apiKey) ? yield* options.apiKey : undefined;
      const apiUrl = Predicate.isNotUndefined(options?.apiUrl) ? yield* options.apiUrl : undefined;
      return yield* make({ apiKey, apiUrl, transformClient: options?.transformClient });
    }),
  );
