/**
 * `ElevenLabsSpeechModel` — the ElevenLabs implementation of `effect-ai-ext`'s
 * `SpeechModel` service (text-to-speech). It exposes both surfaces the
 * abstraction defines: `generate`, returning the full audio buffer, and
 * `stream`, emitting audio byte chunks as they arrive from ElevenLabs'
 * `/stream` endpoint.
 *
 * The streaming surface is fully backpressured and interruption-safe: it
 * returns the {@link ElevenLabsClient} byte stream unchanged (the abstraction
 * only wraps it in a tracing span), and that stream is the raw HTTP body, which
 * effect's `HttpClient` pulls on demand and aborts on interruption. Nothing is
 * buffered whole.
 *
 * The public surface mirrors the mistral archetype: {@link make} for the
 * service effect and {@link layer} for a `SpeechModel` layer over
 * {@link ElevenLabsClient}. Model-level defaults (voice, model id, output
 * format, voice settings) are supplied at construction and overridden per call
 * by the neutral `SpeechOptions` (`voice`, `format`, `sampleRate`).
 *
 * @module ElevenLabsSpeechModel
 *
 * @copyright Thomas Foster
 */

import { SpeechModel } from "@thomasfosterau/effect-ai-ext";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as EffectRecord from "effect/Record";
import * as Stream from "effect/Stream";
import * as AiError from "effect/ai/AiError";
import { ElevenLabsClient } from "./ElevenLabsClient";
import { mediaTypeForOutputFormat, resolveOutputFormat } from "./internal/audio";
import type * as Wire from "./internal/wire";

const MODULE = "ElevenLabsSpeechModel";

/**
 * A selection of well-known ElevenLabs model ids, offered for autocomplete
 * only — {@link Settings} accepts any string.
 */
export type Model =
  | "eleven_multilingual_v2"
  | "eleven_turbo_v2_5"
  | "eleven_flash_v2_5"
  | "eleven_v3"
  | "eleven_monolingual_v1";

/**
 * Construction-time defaults for an {@link ElevenLabsSpeechModel}. The neutral
 * `SpeechOptions` passed per call (`voice`, `format`, `sampleRate`) override
 * the corresponding defaults here.
 */
export interface Settings {
  /** Default ElevenLabs voice id, used when a call omits `voice`. */
  readonly voiceId?: string | undefined;
  /** ElevenLabs model id (e.g. `eleven_multilingual_v2`). */
  readonly modelId?: (string & Record<never, never>) | Model | undefined;
  /**
   * Explicit ElevenLabs `output_format` (e.g. `mp3_44100_128`). Wins over a
   * call's neutral `format` / `sampleRate`.
   */
  readonly outputFormat?: string | undefined;
  /** ISO language code hint passed to the model. */
  readonly languageCode?: string | undefined;
  /** Default voice-settings block (stability, similarity boost, style, …). */
  readonly voiceSettings?: Wire.VoiceSettings | undefined;
  /** Deterministic sampling seed. */
  readonly seed?: number | undefined;
}

const missingVoice = (method: string): AiError.AiError =>
  AiError.make({
    module: MODULE,
    method,
    reason: new AiError.InvalidUserInputError({
      description:
        "ElevenLabs text-to-speech requires a voice id; set `voiceId` on the model or pass `voice` in the request",
    }),
  });

/** Drops keys whose value is `undefined`, preserving the object's type. */
const compact = <T extends Record<string, unknown>>(record: T): T =>
  // SAFETY: only keys whose value is `undefined` are dropped; every other key
  // keeps the value, and so the type, it had in `record`.
  EffectRecord.filter(record, (value) => value !== undefined) as T;

const buildBody = (
  options: SpeechModel.ProviderOptions,
  settings: Settings,
): Wire.TextToSpeechRequest =>
  // SAFETY: `compact` removes every `undefined` field, so each optional
  // `TextToSpeechRequest` field is either absent or set, as the wire type requires.
  compact({
    text: options.text,
    model_id: settings.modelId,
    language_code: settings.languageCode,
    voice_settings: settings.voiceSettings,
    seed: settings.seed,
  }) as Wire.TextToSpeechRequest;

/**
 * Constructs a `SpeechModel.Service` backed by {@link ElevenLabsClient}.
 *
 * @see {@link layer} for providing the service as a `Layer`
 */
export const make = (
  settings?: Settings,
): Effect.Effect<SpeechModel.Service, never, ElevenLabsClient> =>
  Effect.gen(function* () {
    const client = yield* ElevenLabsClient;
    const config = settings ?? {};

    const resolveVoice = (options: SpeechModel.ProviderOptions): string | undefined =>
      options.voice ?? config.voiceId;

    const outputFormatFor = (options: SpeechModel.ProviderOptions): string | undefined =>
      resolveOutputFormat({
        outputFormat: config.outputFormat,
        format: options.format,
        sampleRate: options.sampleRate,
      });

    return yield* SpeechModel.make({
      generate: (options) =>
        Effect.gen(function* () {
          const voice = resolveVoice(options);
          if (voice === undefined) {
            return yield* missingVoice("generate");
          }
          const outputFormat = outputFormatFor(options);
          const result = yield* client.textToSpeech(voice, buildBody(options, config), {
            outputFormat,
          });
          return {
            audio: result.audio,
            mediaType: result.contentType ?? mediaTypeForOutputFormat(outputFormat),
            // ElevenLabs bills per input character; report the submitted length.
            usage: { inputCharacters: options.text.length },
          };
        }),
      stream: (options) => {
        const voice = resolveVoice(options);
        if (voice === undefined) {
          return Stream.fail(missingVoice("stream"));
        }
        return client.textToSpeechStream(voice, buildBody(options, config), {
          outputFormat: outputFormatFor(options),
        });
      },
    });
  });

/**
 * Provides {@link ElevenLabsSpeechModel} as a `SpeechModel` layer, drawing
 * {@link ElevenLabsClient} from another layer.
 */
export const layer = (
  settings?: Settings,
): Layer.Layer<SpeechModel.SpeechModel, never, ElevenLabsClient> =>
  Layer.effect(SpeechModel.SpeechModel, make(settings));
