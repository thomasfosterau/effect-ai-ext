/**
 * Defines the provider-neutral service for voice conversion.
 *
 * A `VoiceConversionModel` re-synthesises input audio in a target voice while
 * preserving the spoken content — the sibling of `LanguageModel` and
 * `EmbeddingModel` from `effect/ai` (which has no voice-conversion
 * module yet). It accepts audio as a byte buffer or a stream, and provider
 * failures stay represented as `AiError` values.
 *
 * The shape mirrors `EmbeddingModel`: a provider supplies one `convert`
 * function through {@link make}, and the result is validated (non-empty audio)
 * before being returned.
 *
 * @since 4.0.0
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";
import { AiError } from "effect/ai";

/**
 * Service tag for voice conversion model operations.
 *
 * **When to use**
 *
 * Use to retrieve or provide the voice conversion model service for an `Effect`
 * program that re-voices audio.
 *
 * @see {@link Service} for the service contract provided by this tag
 * @see {@link make} for constructing a voice conversion model service from a provider
 *
 * @category services
 * @since 4.0.0
 */
export class VoiceConversionModel extends Context.Service<VoiceConversionModel, Service>()(
  "@thomasfosterau/effect-ai-ext/VoiceConversionModel",
) {}

/**
 * Represents usage metadata for a voice conversion operation.
 *
 * **Details**
 *
 * `durationSeconds` is `undefined` when the provider does not report the
 * processed audio duration.
 *
 * @category models
 * @since 4.0.0
 */
export class VoiceConversionUsage extends Schema.Class<VoiceConversionUsage>(
  "@thomasfosterau/effect-ai-ext/VoiceConversionModel/VoiceConversionUsage",
)({
  durationSeconds: Schema.UndefinedOr(Schema.Finite),
}) {}

/**
 * Response for a voice conversion request.
 *
 * @see {@link VoiceConversionUsage} for usage metadata
 *
 * @category models
 * @since 4.0.0
 */
export class VoiceConversionResponse extends Schema.Class<VoiceConversionResponse>(
  "@thomasfosterau/effect-ai-ext/VoiceConversionModel/VoiceConversionResponse",
)({
  /** The re-voiced audio bytes. */
  audio: Schema.Uint8Array,
  /** IANA media type of the audio (e.g. `audio/mpeg`). */
  mediaType: Schema.String,
  usage: VoiceConversionUsage,
}) {}

/**
 * Caller-facing input options for a voice conversion request.
 *
 * @category options
 * @since 4.0.0
 */
export interface VoiceConversionOptions {
  /** The source audio, as a byte buffer or a stream of chunks. */
  readonly audio: Uint8Array | Stream.Stream<Uint8Array>;
  /** Provider voice identifier to convert the audio into. */
  readonly targetVoice: string;
  /** Desired output audio container/codec (e.g. `mp3`, `wav`). */
  readonly format?: string | undefined;
}

/**
 * Provider input options for voice conversion requests.
 *
 * @category options
 * @since 4.0.0
 */
export interface ProviderOptions {
  readonly audio: Uint8Array | Stream.Stream<Uint8Array>;
  readonly targetVoice: string;
  readonly format: string | undefined;
}

/**
 * Provider response contract consumed by {@link make}.
 *
 * @category models
 * @since 4.0.0
 */
export interface ProviderResponse {
  readonly audio: Uint8Array;
  readonly mediaType: string;
  readonly usage: { readonly durationSeconds: number | undefined };
}

/**
 * Defines the service interface for voice conversion operations.
 *
 * @category models
 * @since 4.0.0
 */
export interface Service {
  readonly convert: (
    options: VoiceConversionOptions,
  ) => Effect.Effect<VoiceConversionResponse, AiError.AiError>;
}

const invalidProviderResponse = (description: string): AiError.AiError =>
  AiError.make({
    module: "VoiceConversionModel",
    method: "convert",
    reason: new AiError.InvalidOutputError({ description }),
  });

const mapProviderResponse = (
  response: ProviderResponse,
): Effect.Effect<VoiceConversionResponse, AiError.AiError> => {
  if (response.audio.length === 0) {
    return Effect.fail(invalidProviderResponse("Provider returned an empty audio buffer"));
  }
  return Effect.succeed(
    new VoiceConversionResponse({
      audio: response.audio,
      mediaType: response.mediaType,
      usage: new VoiceConversionUsage({ durationSeconds: response.usage.durationSeconds }),
    }),
  );
};

/**
 * Creates a `VoiceConversionModel` service from a provider convert
 * implementation — the analogue of `EmbeddingModel.make`.
 *
 * **Details**
 *
 * The provider's audio buffer must be non-empty or the call fails with
 * `AiError.InvalidOutputError`.
 *
 * @see {@link Service} for the service shape returned by this constructor
 * @see {@link ProviderOptions} for the input passed to the provider implementation
 * @see {@link ProviderResponse} for the provider response contract consumed by this constructor
 *
 * @category constructors
 * @since 4.0.0
 */
export const make = (params: {
  readonly convert: (
    options: ProviderOptions,
  ) => Effect.Effect<ProviderResponse, AiError.AiError>;
}): Effect.Effect<Service> =>
  Effect.sync(() =>
    VoiceConversionModel.of({
      convert: (options) =>
        params
          .convert({
            audio: options.audio,
            targetVoice: options.targetVoice,
            format: options.format,
          })
          .pipe(
            Effect.flatMap(mapProviderResponse),
            Effect.withSpan("VoiceConversionModel.convert"),
          ),
    }),
  );
