/**
 * Defines the provider-neutral service for text-to-speech synthesis.
 *
 * A `SpeechModel` turns text into audio — the sibling of `LanguageModel` and
 * `EmbeddingModel` from `effect/ai` (which has no speech module yet).
 * It exposes both a one-shot surface (`generate`, returning the full audio
 * buffer) and a streaming surface (`stream`, emitting audio chunks), and
 * represents provider failures as `AiError` values.
 *
 * The shape mirrors `EmbeddingModel`: a provider supplies `generate` and
 * `stream` functions through {@link make}, and the one-shot result is validated
 * (non-empty audio) before being returned.
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AiError } from "effect/ai";

/**
 * Service tag for speech (text-to-speech) model operations.
 *
 * **When to use**
 *
 * Use to retrieve or provide the speech model service for an `Effect` program
 * that synthesises audio from text.
 *
 * @see {@link Service} for the service contract provided by this tag
 * @see {@link make} for constructing a speech model service from a provider
 *
 * @category services
 */
export class SpeechModel extends Context.Service<SpeechModel, Service>()(
  "@thomasfosterau/effect-ai-ext/SpeechModel",
) {}

/**
 * Represents usage metadata for a speech synthesis operation.
 *
 * **Details**
 *
 * `inputCharacters` is `undefined` when the provider does not report usage.
 *
 * @category models
 */
export class SpeechUsage extends Schema.Class<SpeechUsage>(
  "@thomasfosterau/effect-ai-ext/SpeechModel/SpeechUsage",
)({
  inputCharacters: Schema.UndefinedOr(Schema.Finite),
}) {}

/**
 * Response for a one-shot speech synthesis request.
 *
 * @see {@link SpeechUsage} for usage metadata
 *
 * @category models
 */
export class SpeechResponse extends Schema.Class<SpeechResponse>(
  "@thomasfosterau/effect-ai-ext/SpeechModel/SpeechResponse",
)({
  /** The synthesised audio bytes. */
  audio: Schema.Uint8Array,
  /** IANA media type of the audio (e.g. `audio/mpeg`). */
  mediaType: Schema.String,
  usage: SpeechUsage,
}) {}

/**
 * Caller-facing input options for a speech synthesis request.
 *
 * @category options
 */
export interface SpeechOptions {
  /** The text to synthesise. */
  readonly text: string;
  /** Provider voice identifier (provider default when omitted). */
  readonly voice?: string | undefined;
  /** Desired audio container/codec (e.g. `mp3`, `wav`, `pcm`). */
  readonly format?: string | undefined;
  /** Desired sample rate in Hz. */
  readonly sampleRate?: number | undefined;
}

/**
 * Provider input options for speech synthesis requests.
 *
 * @category options
 */
export interface ProviderOptions {
  readonly text: string;
  readonly voice: string | undefined;
  readonly format: string | undefined;
  readonly sampleRate: number | undefined;
}

/**
 * Provider response contract for the one-shot surface, consumed by {@link make}.
 *
 * @category models
 */
export interface ProviderResponse {
  readonly audio: Uint8Array;
  readonly mediaType: string;
  readonly usage: { readonly inputCharacters: number | undefined };
}

/**
 * Defines the service interface for speech operations.
 *
 * @category models
 */
export interface Service {
  readonly generate: (options: SpeechOptions) => Effect.Effect<SpeechResponse, AiError.AiError>;
  readonly stream: (options: SpeechOptions) => Stream.Stream<Uint8Array, AiError.AiError>;
}

const invalidProviderResponse = (description: string): AiError.AiError =>
  AiError.make({
    module: "SpeechModel",
    method: "generate",
    reason: new AiError.InvalidOutputError({ description }),
  });

const mapProviderResponse = (
  response: ProviderResponse,
): Effect.Effect<SpeechResponse, AiError.AiError> => {
  if (response.audio.length === 0) {
    return Effect.fail(invalidProviderResponse("Provider returned an empty audio buffer"));
  }
  return Effect.succeed(
    new SpeechResponse({
      audio: response.audio,
      mediaType: response.mediaType,
      usage: new SpeechUsage({ inputCharacters: response.usage.inputCharacters }),
    }),
  );
};

const toProviderOptions = (options: SpeechOptions): ProviderOptions => ({
  text: options.text,
  voice: options.voice,
  format: options.format,
  sampleRate: options.sampleRate,
});

/**
 * Creates a `SpeechModel` service from provider synthesis implementations — the
 * analogue of `EmbeddingModel.make`.
 *
 * **Details**
 *
 * The `generate` hook backs the one-shot surface; its audio buffer must be
 * non-empty or the call fails with `AiError.InvalidOutputError`. The `stream`
 * hook backs the streaming surface and is passed through unchanged, wrapped in a
 * tracing span.
 *
 * @see {@link Service} for the service shape returned by this constructor
 * @see {@link ProviderOptions} for the input passed to the provider implementations
 * @see {@link ProviderResponse} for the one-shot provider response contract
 *
 * @category constructors
 */
export const make = (params: {
  readonly generate: (
    options: ProviderOptions,
  ) => Effect.Effect<ProviderResponse, AiError.AiError>;
  readonly stream: (options: ProviderOptions) => Stream.Stream<Uint8Array, AiError.AiError>;
}): Effect.Effect<Service> =>
  Effect.sync(() =>
    SpeechModel.of({
      generate: (options) =>
        params
          .generate(toProviderOptions(options))
          .pipe(
            Effect.flatMap(mapProviderResponse),
            Effect.withSpan("SpeechModel.generate"),
          ),
      stream: (options) =>
        params.stream(toProviderOptions(options)).pipe(Stream.withSpan("SpeechModel.stream")),
    }),
  );
