/**
 * @copyright Thomas Foster
 *
 * `ElevenLabsVoiceConversionModel` — the ElevenLabs implementation of
 * `effect-ai-ext`'s `VoiceConversionModel` service (speech-to-speech). It
 * accepts source audio as bytes or a stream, uploads it as
 * `multipart/form-data` to `/v1/speech-to-speech/{voice_id}`, and returns the
 * re-voiced audio buffer.
 *
 * Like Scribe, speech-to-speech is a whole-file endpoint, so a streamed input
 * is drained to a `Blob` before upload.
 *
 * @module ElevenLabsVoiceConversionModel
 */

import { VoiceConversionModel } from "@thomasfosterau/effect-ai-ext";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ElevenLabsClient } from "./ElevenLabsClient";
import { collectBytes, mediaTypeForOutputFormat, resolveOutputFormat, toBlob } from "./internal/audio";
import type * as Wire from "./internal/wire";

/**
 * A selection of well-known ElevenLabs speech-to-speech model ids, offered for
 * autocomplete only — {@link Settings} accepts any string.
 */
export type Model = "eleven_multilingual_sts_v2" | "eleven_english_sts_v2";

/** Construction-time defaults for an {@link ElevenLabsVoiceConversionModel}. */
export interface Settings {
  /** ElevenLabs speech-to-speech model id (e.g. `eleven_multilingual_sts_v2`). */
  readonly modelId?: (string & {}) | Model | undefined;
  /**
   * Explicit ElevenLabs `output_format` (e.g. `mp3_44100_128`). Wins over a
   * call's neutral `format`.
   */
  readonly outputFormat?: string | undefined;
  /** Voice-settings block applied to the target voice. */
  readonly voiceSettings?: Wire.VoiceSettings | undefined;
  /** Strip background noise from the source audio before conversion. */
  readonly removeBackgroundNoise?: boolean | undefined;
  /** Deterministic sampling seed. */
  readonly seed?: number | undefined;
  /** Media-type hint for the uploaded source audio (e.g. `audio/mpeg`). */
  readonly inputMediaType?: string | undefined;
}

/** Drops keys whose value is `undefined`, preserving the object's type. */
const compact = <T extends Record<string, unknown>>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

/**
 * Constructs a `VoiceConversionModel.Service` backed by {@link ElevenLabsClient}.
 *
 * @see {@link layer} for providing the service as a `Layer`
 */
export const make = (
  settings?: Settings,
): Effect.Effect<VoiceConversionModel.Service, never, ElevenLabsClient> =>
  Effect.gen(function* () {
    const client = yield* ElevenLabsClient;
    const config = settings ?? {};

    return yield* VoiceConversionModel.make({
      convert: (options) =>
        Effect.gen(function* () {
          const bytes = yield* collectBytes(options.audio);
          const outputFormat = resolveOutputFormat({
            outputFormat: config.outputFormat,
            format: options.format,
            sampleRate: undefined,
          });
          const form = compact({
            audio: toBlob(bytes, config.inputMediaType),
            model_id: config.modelId,
            voice_settings:
              config.voiceSettings !== undefined ? JSON.stringify(config.voiceSettings) : undefined,
            remove_background_noise: config.removeBackgroundNoise,
            seed: config.seed,
          }) as unknown as Wire.SpeechToSpeechForm;
          const result = yield* client.speechToSpeech(options.targetVoice, form, { outputFormat });
          return {
            audio: result.audio,
            mediaType: result.contentType ?? mediaTypeForOutputFormat(outputFormat),
            usage: { durationSeconds: undefined },
          };
        }),
    });
  });

/**
 * Provides {@link ElevenLabsVoiceConversionModel} as a `VoiceConversionModel`
 * layer, drawing {@link ElevenLabsClient} from another layer.
 */
export const layer = (
  settings?: Settings,
): Layer.Layer<VoiceConversionModel.VoiceConversionModel, never, ElevenLabsClient> =>
  Layer.effect(VoiceConversionModel.VoiceConversionModel, make(settings));
