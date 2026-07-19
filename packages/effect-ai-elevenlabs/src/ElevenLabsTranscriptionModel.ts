/**
 * @copyright Thomas Foster
 *
 * `ElevenLabsTranscriptionModel` — the ElevenLabs implementation of
 * `effect-ai-ext`'s `TranscriptionModel` service (speech-to-text) over Scribe.
 * It accepts audio as bytes or a stream, uploads it as `multipart/form-data`,
 * and maps the Scribe transcript into the neutral response: the full text,
 * per-word segment timestamps, and the detected language.
 *
 * Scribe is a whole-file endpoint, so a streamed input is drained to a `Blob`
 * before upload — the only audio buffered anywhere in this package, and bounded
 * by the caller's own input.
 *
 * @module ElevenLabsTranscriptionModel
 */

import { TranscriptionModel } from "@thomasfosterau/effect-ai-ext";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ElevenLabsClient } from "./ElevenLabsClient";
import { collectBytes, toBlob } from "./internal/audio";
import type * as Wire from "./internal/wire";

/** The default Scribe model id. */
const DEFAULT_MODEL_ID = "scribe_v1";

/**
 * A selection of well-known Scribe model ids, offered for autocomplete only —
 * {@link Settings} accepts any string.
 */
export type Model = "scribe_v1" | "scribe_v1_experimental";

/** Construction-time defaults for an {@link ElevenLabsTranscriptionModel}. */
export interface Settings {
  /** Scribe model id (default `scribe_v1`). */
  readonly modelId?: (string & {}) | Model | undefined;
  /** Default language-code hint; a call's `language` overrides it. */
  readonly languageCode?: string | undefined;
  /** Timestamp granularity (`word` or `character`; default `word`). */
  readonly timestampsGranularity?: string | undefined;
  /** Annotate speakers in the transcript. */
  readonly diarize?: boolean | undefined;
  /** Tag non-speech audio events (laughter, etc.). */
  readonly tagAudioEvents?: boolean | undefined;
}

/** Drops keys whose value is `undefined`, preserving the object's type. */
const compact = <T extends Record<string, unknown>>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

/** Maps a Scribe transcript into the neutral provider response. */
const mapTranscript = (body: Wire.SpeechToTextResponse): TranscriptionModel.ProviderResponse => {
  const words = body.words ?? undefined;

  let segments:
    | ReadonlyArray<{ readonly text: string; readonly start: number; readonly end: number }>
    | undefined;
  let maxEnd: number | undefined;

  if (words !== undefined) {
    const mapped: Array<{ readonly text: string; readonly start: number; readonly end: number }> =
      [];
    for (const word of words) {
      if (typeof word.end === "number") {
        maxEnd = maxEnd === undefined ? word.end : Math.max(maxEnd, word.end);
      }
      // Only spoken words carry meaningful segment offsets; skip `spacing` /
      // `audio_event` tokens and any word missing a timestamp pair.
      if (word.type !== undefined && word.type !== null && word.type !== "word") {
        continue;
      }
      if (typeof word.start !== "number" || typeof word.end !== "number") {
        continue;
      }
      mapped.push({ text: word.text ?? "", start: word.start, end: word.end });
    }
    segments = mapped.length > 0 ? mapped : undefined;
  }

  return {
    text: body.text ?? "",
    segments,
    language: body.language_code ?? undefined,
    usage: { durationSeconds: maxEnd },
  };
};

/**
 * Constructs a `TranscriptionModel.Service` backed by {@link ElevenLabsClient}.
 *
 * @see {@link layer} for providing the service as a `Layer`
 */
export const make = (
  settings?: Settings,
): Effect.Effect<TranscriptionModel.Service, never, ElevenLabsClient> =>
  Effect.gen(function* () {
    const client = yield* ElevenLabsClient;
    const config = settings ?? {};

    return yield* TranscriptionModel.make({
      transcribe: (options) =>
        Effect.gen(function* () {
          const bytes = yield* collectBytes(options.audio);
          const form = compact({
            file: toBlob(bytes, options.mediaType),
            model_id: config.modelId ?? DEFAULT_MODEL_ID,
            language_code: options.language ?? config.languageCode,
            timestamps_granularity: config.timestampsGranularity,
            diarize: config.diarize,
            tag_audio_events: config.tagAudioEvents,
          }) as unknown as Wire.SpeechToTextForm;
          const [body] = yield* client.speechToText(form);
          return mapTranscript(body);
        }),
    });
  });

/**
 * Provides {@link ElevenLabsTranscriptionModel} as a `TranscriptionModel`
 * layer, drawing {@link ElevenLabsClient} from another layer.
 */
export const layer = (
  settings?: Settings,
): Layer.Layer<TranscriptionModel.TranscriptionModel, never, ElevenLabsClient> =>
  Layer.effect(TranscriptionModel.TranscriptionModel, make(settings));
