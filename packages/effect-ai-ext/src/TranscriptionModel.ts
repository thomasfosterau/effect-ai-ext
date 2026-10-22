/**
 * Defines the provider-neutral service for speech-to-text transcription.
 *
 * A `TranscriptionModel` turns audio into text — the sibling of `LanguageModel`
 * and `EmbeddingModel` from `effect/ai` (which has no transcription
 * module yet). It accepts audio as a byte buffer or a stream, optionally returns
 * per-segment timestamps and a detected language, and represents provider
 * failures as `AiError` values.
 *
 * The shape mirrors `EmbeddingModel`: a provider supplies one `transcribe`
 * function through {@link make}, and the result is validated (finite,
 * non-decreasing segment timestamps) before being returned.
 */

import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";
import { AiError } from "effect/ai";

/**
 * Service tag for transcription (speech-to-text) model operations.
 *
 * **When to use**
 *
 * Use to retrieve or provide the transcription model service for an `Effect`
 * program that transcribes audio into text.
 *
 * @see {@link Service} for the service contract provided by this tag
 * @see {@link make} for constructing a transcription model service from a provider
 *
 * @category services
 */
export class TranscriptionModel extends Context.Service<TranscriptionModel, Service>()(
  "@thomasfosterau/effect-ai-ext/TranscriptionModel",
) {}

/**
 * Represents usage metadata for a transcription operation.
 *
 * **Details**
 *
 * `durationSeconds` is `undefined` when the provider does not report the
 * transcribed audio duration.
 *
 * @category models
 */
export class TranscriptionUsage extends Schema.Class<TranscriptionUsage>(
  "@thomasfosterau/effect-ai-ext/TranscriptionModel/TranscriptionUsage",
)({
  durationSeconds: Schema.UndefinedOr(Schema.Finite),
}) {}

/**
 * One transcribed segment with its start and end offsets in seconds.
 *
 * @category models
 */
export class TranscriptionSegment extends Schema.Class<TranscriptionSegment>(
  "@thomasfosterau/effect-ai-ext/TranscriptionModel/TranscriptionSegment",
)({
  text: Schema.String,
  /** Segment start offset in seconds. */
  start: Schema.Finite,
  /** Segment end offset in seconds. */
  end: Schema.Finite,
}) {}

/**
 * Response for a transcription request.
 *
 * **Details**
 *
 * `segments` and `language` are `undefined` when the provider does not report
 * them.
 *
 * @see {@link TranscriptionSegment} for individual segments
 * @see {@link TranscriptionUsage} for usage metadata
 *
 * @category models
 */
export class TranscriptionResponse extends Schema.Class<TranscriptionResponse>(
  "@thomasfosterau/effect-ai-ext/TranscriptionModel/TranscriptionResponse",
)({
  text: Schema.String,
  segments: Schema.UndefinedOr(Schema.Array(TranscriptionSegment)),
  language: Schema.UndefinedOr(Schema.String),
  usage: TranscriptionUsage,
}) {}

/**
 * Caller-facing input options for a transcription request.
 *
 * @category options
 */
export interface TranscriptionOptions {
  /** The audio to transcribe, as a byte buffer or a stream of chunks. */
  readonly audio: Uint8Array | Stream.Stream<Uint8Array>;
  /** IANA media type of the audio (e.g. `audio/mpeg`). */
  readonly mediaType?: string | undefined;
  /** Hint for the spoken language (auto-detected when omitted). */
  readonly language?: string | undefined;
}

/**
 * Provider input options for transcription requests.
 *
 * @category options
 */
export interface ProviderOptions {
  readonly audio: Uint8Array | Stream.Stream<Uint8Array>;
  readonly mediaType: string | undefined;
  readonly language: string | undefined;
}

/**
 * Provider response contract consumed by {@link make}.
 *
 * @category models
 */
export interface ProviderResponse {
  readonly text: string;
  readonly segments:
    | ReadonlyArray<{ readonly text: string; readonly start: number; readonly end: number }>
    | undefined;
  readonly language: string | undefined;
  readonly usage: { readonly durationSeconds: number | undefined };
}

/**
 * Defines the service interface for transcription operations.
 *
 * @category models
 */
export interface Service {
  readonly transcribe: (
    options: TranscriptionOptions,
  ) => Effect.Effect<TranscriptionResponse, AiError.AiError>;
}

const invalidProviderResponse = (description: string): AiError.AiError =>
  AiError.make({
    module: "TranscriptionModel",
    method: "transcribe",
    reason: new AiError.InvalidOutputError({ description }),
  });

const mapProviderResponse = (
  response: ProviderResponse,
): Effect.Effect<TranscriptionResponse, AiError.AiError> => {
  const invalid = Arr.findFirst(response.segments ?? [], (segment) =>
    !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
      ? Option.some(
          `Provider returned a segment with non-finite timestamps (${segment.start}, ${segment.end})`,
        )
      : segment.end < segment.start
        ? Option.some(
            `Provider returned a segment ending (${segment.end}) before it starts (${segment.start})`,
          )
        : Option.none(),
  );
  if (Option.isSome(invalid)) {
    return Effect.fail(invalidProviderResponse(invalid.value));
  }
  const segments =
    response.segments === undefined
      ? undefined
      : Arr.map(
          response.segments,
          (segment) =>
            new TranscriptionSegment({
              text: segment.text,
              start: segment.start,
              end: segment.end,
            }),
        );
  return Effect.succeed(
    new TranscriptionResponse({
      text: response.text,
      segments,
      language: response.language,
      usage: new TranscriptionUsage({ durationSeconds: response.usage.durationSeconds }),
    }),
  );
};

/**
 * Creates a `TranscriptionModel` service from a provider transcribe
 * implementation — the analogue of `EmbeddingModel.make`.
 *
 * **Details**
 *
 * When the provider reports segments, every segment's timestamps must be finite
 * and non-decreasing (`end >= start`); violations fail with
 * `AiError.InvalidOutputError`.
 *
 * @see {@link Service} for the service shape returned by this constructor
 * @see {@link ProviderOptions} for the input passed to the provider implementation
 * @see {@link ProviderResponse} for the provider response contract consumed by this constructor
 *
 * @category constructors
 */
export const make = (params: {
  readonly transcribe: (
    options: ProviderOptions,
  ) => Effect.Effect<ProviderResponse, AiError.AiError>;
}): Effect.Effect<Service> =>
  Effect.sync(() =>
    TranscriptionModel.of({
      transcribe: (options) =>
        params
          .transcribe({
            audio: options.audio,
            mediaType: options.mediaType,
            language: options.language,
          })
          .pipe(
            Effect.flatMap(mapProviderResponse),
            Effect.withSpan("TranscriptionModel.transcribe"),
          ),
    }),
  );
