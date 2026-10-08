/**
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
 *
 * @copyright Thomas Foster
 */

import { TranscriptionModel } from "@thomasfosterau/effect-ai-ext";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
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

/** One spoken word's span in the transcript. */
interface Segment {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A token as a segment: only spoken words carry meaningful segment offsets, so
 * `spacing` / `audio_event` tokens and any word missing a timestamp pair map
 * to `None`.
 */
const toSegment = (word: Wire.TranscriptWord): Option.Option<Segment> =>
  (Predicate.isNullish(word.type) || word.type === "word") &&
  Predicate.isNumber(word.start) &&
  Predicate.isNumber(word.end)
    ? Option.some({ text: word.text ?? "", start: word.start, end: word.end })
    : Option.none();

/** The latest end offset any token reports: the transcript's duration. */
const latestEnd = (words: ReadonlyArray<Wire.TranscriptWord>): number | undefined =>
  Arr.match(
    Arr.filter(
      Arr.map(words, (word) => word.end),
      Predicate.isNumber,
    ),
    {
      onEmpty: () => undefined,
      onNonEmpty: (ends) => Arr.max(ends, Order.Number),
    },
  );

/** Maps a Scribe transcript into the neutral provider response. */
const mapTranscript = (body: Wire.SpeechToTextResponse): TranscriptionModel.ProviderResponse => {
  const words = body.words ?? [];
  const segments = Arr.getSomes(Arr.map(words, toSegment));
  return {
    text: body.text ?? "",
    segments: Arr.isReadonlyArrayNonEmpty(segments) ? segments : undefined,
    language: body.language_code ?? undefined,
    usage: { durationSeconds: latestEnd(words) },
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
          const form: Wire.SpeechToTextForm = {
            file: toBlob(bytes, options.mediaType),
            model_id: config.modelId ?? DEFAULT_MODEL_ID,
            language_code: options.language ?? config.languageCode,
            timestamps_granularity: config.timestampsGranularity,
            diarize: config.diarize,
            tag_audio_events: config.tagAudioEvents,
          };
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
