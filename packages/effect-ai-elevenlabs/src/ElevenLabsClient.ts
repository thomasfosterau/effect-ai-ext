/**
 * `ElevenLabsClient` — the low-level Effect service for the ElevenLabs audio
 * API. It wraps an `HttpClient` with base-URL prefixing and `xi-api-key`
 * authentication, then exposes the four calls the models need: one-shot and
 * streaming text-to-speech (binary audio out), Scribe speech-to-text (a
 * multipart upload, JSON transcript back), and speech-to-speech voice
 * conversion (multipart in, binary audio out). Every failure is mapped into the
 * unified `AiError` type.
 *
 * ElevenLabs has no upstream `@effect/ai-*` package to repoint, so the wire
 * format is handled directly here against the request interfaces / transcript
 * schema in `internal/wire`. The `apiUrl` override is the BYOK contract — a
 * routing layer (the gateway) repoints the client through it.
 *
 * **Streaming discipline.** The streaming TTS surface returns the HTTP
 * response body *as a stream* (`response.stream`), which effect's `HttpClient`
 * makes both backpressured (chunks are pulled on demand) and
 * interruption-safe (interrupting the consumer runs the stream's finalizer,
 * which aborts the in-flight request). Nothing is buffered whole.
 *
 * @module ElevenLabsClient
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
import * as Stream from "effect/Stream";
import type * as AiError from "effect/ai/AiError";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Errors from "./internal/errors";
import * as Wire from "./internal/wire";

/** The default ElevenLabs API base URL. */
export const defaultApiUrl = "https://api.elevenlabs.io";

/** The text-to-speech endpoint prefix; the voice id and optional `/stream` follow. */
const TEXT_TO_SPEECH_PATH = "/v1/text-to-speech";

/** The Scribe speech-to-text endpoint path. */
const SPEECH_TO_TEXT_PATH = "/v1/speech-to-text";

/** The speech-to-speech (voice conversion) endpoint prefix; the voice id follows. */
const SPEECH_TO_SPEECH_PATH = "/v1/speech-to-speech";

// =============================================================================
// Service Interface
// =============================================================================

/** Raw audio bytes paired with the response's declared content type (if any). */
export interface AudioResult {
  readonly audio: Uint8Array;
  readonly contentType: string | undefined;
}

/**
 * Optional per-call request tuning shared by the audio-producing endpoints.
 */
export interface AudioRequestOptions {
  /** The ElevenLabs `output_format` query value (e.g. `mp3_44100_128`). */
  readonly outputFormat?: string | undefined;
}

/**
 * The ElevenLabs client service. Every method surfaces only `AiError` on the
 * error channel, so consumers never handle transport- or schema-level failures
 * directly.
 */
export interface Service {
  /**
   * Synthesises speech for `voiceId`, returning the full audio buffer and the
   * response's content type.
   */
  readonly textToSpeech: (
    voiceId: string,
    request: Wire.TextToSpeechRequest,
    options?: AudioRequestOptions,
  ) => Effect.Effect<AudioResult, AiError.AiError>;

  /**
   * Synthesises speech for `voiceId` as a backpressured stream of audio byte
   * chunks. Interrupting the consumer aborts the in-flight HTTP request.
   */
  readonly textToSpeechStream: (
    voiceId: string,
    request: Wire.TextToSpeechRequest,
    options?: AudioRequestOptions,
  ) => Stream.Stream<Uint8Array, AiError.AiError>;

  /**
   * Transcribes an uploaded audio file through Scribe, returning the decoded
   * transcript paired with the raw HTTP response.
   */
  readonly speechToText: (
    request: Wire.SpeechToTextForm,
  ) => Effect.Effect<
    readonly [body: Wire.SpeechToTextResponse, response: HttpClientResponse.HttpClientResponse],
    AiError.AiError
  >;

  /**
   * Re-voices an uploaded audio file into `voiceId`, returning the full audio
   * buffer and the response's content type.
   */
  readonly speechToSpeech: (
    voiceId: string,
    request: Wire.SpeechToSpeechForm,
    options?: AudioRequestOptions,
  ) => Effect.Effect<AudioResult, AiError.AiError>;
}

/**
 * Service tag for the ElevenLabs client.
 *
 * @see {@link make} for constructing the client effectfully
 * @see {@link layer} for providing it from explicit options
 * @see {@link layerConfig} for providing it from `Config`
 */
export class ElevenLabsClient extends Context.Service<ElevenLabsClient, Service>()(
  "@thomasfosterau/effect-ai-elevenlabs/ElevenLabsClient",
) {}

// =============================================================================
// Options
// =============================================================================

/** Configuration for constructing an {@link ElevenLabsClient}. */
export interface Options {
  /**
   * The ElevenLabs API key. Sent as the `xi-api-key` header. Omit for proxied
   * setups (e.g. a gateway that injects the credential) or tests — requests
   * then carry no `xi-api-key` header.
   */
  readonly apiKey?: Redacted.Redacted<string> | undefined;
  /**
   * The base URL for the API. Override to target a proxy or gateway route.
   *
   * @default "https://api.elevenlabs.io"
   */
  readonly apiUrl?: string | undefined;
  /**
   * Optional transformer for the underlying `HttpClient` (middleware, logging,
   * custom retry, etc.).
   */
  readonly transformClient?: ((client: HttpClient.HttpClient) => HttpClient.HttpClient) | undefined;
}

// =============================================================================
// Constructor
// =============================================================================

/** Builds the `/v1/text-to-speech/{voice_id}` path, optionally streaming. */
const textToSpeechPath = (voiceId: string, streaming: boolean): string =>
  `${TEXT_TO_SPEECH_PATH}/${encodeURIComponent(voiceId)}${streaming ? "/stream" : ""}`;

/** Builds the `/v1/speech-to-speech/{voice_id}` path. */
const speechToSpeechPath = (voiceId: string): string =>
  `${SPEECH_TO_SPEECH_PATH}/${encodeURIComponent(voiceId)}`;

/** Reads the response's content type, stripping any `; charset=…` parameters. */
const contentTypeOf = (response: HttpClientResponse.HttpClientResponse): string | undefined => {
  const raw = response.headers["content-type"] as string | undefined;
  if (raw === undefined) {
    return undefined;
  }
  const base = raw.split(";")[0].trim();
  return base.length > 0 ? base : undefined;
};

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
          ? HttpClientRequest.setHeader("xi-api-key", Redacted.value(options.apiKey))
          : identity,
      ),
    ),
    Predicate.isNotUndefined(options.transformClient) ? options.transformClient : identity,
  );

  const httpClientOk = HttpClient.filterStatusOk(httpClient);

  /** Reads a completed audio response into bytes + declared content type. */
  const readAudio = (
    response: HttpClientResponse.HttpClientResponse,
  ): Effect.Effect<AudioResult, HttpClientError.HttpClientError> =>
    response.arrayBuffer.pipe(
      Effect.map((buffer) => ({
        audio: new Uint8Array(buffer),
        contentType: contentTypeOf(response),
      })),
    );

  const withOutputFormat = (
    request: HttpClientRequest.HttpClientRequest,
    options: AudioRequestOptions | undefined,
  ): HttpClientRequest.HttpClientRequest =>
    Predicate.isNotUndefined(options?.outputFormat)
      ? HttpClientRequest.setUrlParam(request, "output_format", options.outputFormat)
      : request;

  const textToSpeech: Service["textToSpeech"] = (voiceId, request, options) => {
    const httpRequest = withOutputFormat(
      HttpClientRequest.post(textToSpeechPath(voiceId, false), {
        body: HttpBody.jsonUnsafe(request),
      }),
      options,
    );
    return httpClientOk.execute(httpRequest).pipe(
      Effect.flatMap(readAudio),
      Effect.catchTag("HttpClientError", (error) =>
        Errors.mapHttpClientError(error, "textToSpeech"),
      ),
    );
  };

  const textToSpeechStream: Service["textToSpeechStream"] = (voiceId, request, options) => {
    const httpRequest = withOutputFormat(
      HttpClientRequest.post(textToSpeechPath(voiceId, true), {
        body: HttpBody.jsonUnsafe(request),
      }),
      options,
    );
    // `response.stream` is the raw HTTP body: effect's HttpClient pulls chunks
    // on demand (backpressure) and aborts the request if the consumer is
    // interrupted. It is threaded straight through — never collected here.
    return httpClientOk.execute(httpRequest).pipe(
      Effect.map((response) => response.stream),
      Stream.unwrap,
      Stream.catchTag("HttpClientError", (error) =>
        Stream.fromEffect(Errors.mapHttpClientError(error, "textToSpeechStream")),
      ),
    );
  };

  const speechToText: Service["speechToText"] = (request) => {
    const httpRequest = HttpClientRequest.post(SPEECH_TO_TEXT_PATH).pipe(
      HttpClientRequest.bodyFormDataRecord(request as unknown as HttpBody.FormDataInput),
      HttpClientRequest.acceptJson,
    );
    return httpClientOk.execute(httpRequest).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(Wire.SpeechToTextResponse)(response).pipe(
          Effect.map((body) => [body, response] as const),
        ),
      ),
      Effect.catchTags({
        HttpClientError: (error: HttpClientError.HttpClientError) =>
          Errors.mapHttpClientError(error, "speechToText"),
        SchemaError: (error) => Effect.fail(Errors.mapSchemaError(error, "speechToText")),
      }),
    );
  };

  const speechToSpeech: Service["speechToSpeech"] = (voiceId, request, options) => {
    const httpRequest = withOutputFormat(
      HttpClientRequest.post(speechToSpeechPath(voiceId)).pipe(
        HttpClientRequest.bodyFormDataRecord(request as unknown as HttpBody.FormDataInput),
      ),
      options,
    );
    return httpClientOk.execute(httpRequest).pipe(
      Effect.flatMap(readAudio),
      Effect.catchTag("HttpClientError", (error) =>
        Errors.mapHttpClientError(error, "speechToSpeech"),
      ),
    );
  };

  return ElevenLabsClient.of({
    textToSpeech,
    textToSpeechStream,
    speechToText,
    speechToSpeech,
  });
});

// =============================================================================
// Layers
// =============================================================================

/**
 * Provides {@link ElevenLabsClient} as a `Layer` from explicit {@link Options}.
 */
export const layer = (
  options: Options,
): Layer.Layer<ElevenLabsClient, never, HttpClient.HttpClient> =>
  Layer.effect(ElevenLabsClient, make(options));

/**
 * Provides {@link ElevenLabsClient} as a `Layer`, loading its settings through
 * Effect's `Config` module (e.g. from environment variables or a secrets
 * provider).
 */
export const layerConfig = (options?: {
  readonly apiKey?: Config.Config<Redacted.Redacted<string> | undefined> | undefined;
  readonly apiUrl?: Config.Config<string> | undefined;
  readonly transformClient?: ((client: HttpClient.HttpClient) => HttpClient.HttpClient) | undefined;
}): Layer.Layer<ElevenLabsClient, Config.ConfigError, HttpClient.HttpClient> =>
  Layer.effect(
    ElevenLabsClient,
    Effect.gen(function* () {
      const apiKey = Predicate.isNotUndefined(options?.apiKey) ? yield* options.apiKey : undefined;
      const apiUrl = Predicate.isNotUndefined(options?.apiUrl) ? yield* options.apiUrl : undefined;
      return yield* make({ apiKey, apiUrl, transformClient: options?.transformClient });
    }),
  );
