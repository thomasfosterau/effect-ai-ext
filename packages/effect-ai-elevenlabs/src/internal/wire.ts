/**
 * @copyright Thomas Foster
 *
 * Wire-format definitions for the ElevenLabs endpoints this package speaks:
 * `/v1/text-to-speech` (TTS), `/v1/speech-to-text` (Scribe STT), and
 * `/v1/speech-to-speech` (voice conversion).
 *
 * Request payloads are hand-built plain objects (typed by the `*Request` /
 * `*Form` interfaces here) rather than encoded through a schema — the provider
 * constructs them field-by-field and sends them as JSON or `multipart/form-data`.
 * Only the JSON response bodies get an Effect `Schema` (the STT transcript),
 * because that is the untrusted input a model must decode and validate; audio
 * responses are raw bytes and carry no schema.
 *
 * The transcript schema is modelled leniently (`Schema.optional` +
 * `Schema.NullOr`, `type` left a free `string`) so a newly-added ElevenLabs
 * field or word type never fails decoding of an otherwise-valid response — the
 * mapping layer narrows what it knows and defaults the rest.
 *
 * @module internal/wire
 */

import * as Schema from "effect/Schema";

// ── Text-to-speech request (JSON body) ────────────────────────────────

/**
 * ElevenLabs voice-settings block controlling delivery. Every field is
 * optional; omitted fields fall back to the voice's configured defaults.
 */
export interface VoiceSettings {
  readonly stability?: number;
  readonly similarity_boost?: number;
  readonly style?: number;
  readonly use_speaker_boost?: boolean;
  readonly speed?: number;
}

/** The JSON body of a `/v1/text-to-speech/{voice_id}` request. */
export interface TextToSpeechRequest {
  readonly text: string;
  readonly model_id?: string;
  readonly language_code?: string;
  readonly voice_settings?: VoiceSettings;
  readonly seed?: number;
  readonly previous_text?: string;
  readonly next_text?: string;
}

// ── Speech-to-text form (multipart/form-data) ─────────────────────────

/**
 * The `multipart/form-data` fields of a `/v1/speech-to-text` request. `file`
 * is the source audio; the remaining fields tune Scribe. Sent as a
 * `FormData` body — `Blob`/primitive values are appended directly.
 */
export interface SpeechToTextForm {
  readonly file: Blob;
  readonly model_id: string;
  readonly language_code?: string;
  readonly timestamps_granularity?: string;
  readonly diarize?: boolean;
  readonly tag_audio_events?: boolean;
}

// ── Speech-to-speech form (multipart/form-data) ───────────────────────

/**
 * The `multipart/form-data` fields of a `/v1/speech-to-speech/{voice_id}`
 * request. `audio` is the source audio to re-voice; `voice_settings` is a
 * JSON-encoded {@link VoiceSettings} string when present.
 */
export interface SpeechToSpeechForm {
  readonly audio: Blob;
  readonly model_id?: string;
  readonly voice_settings?: string;
  readonly remove_background_noise?: boolean;
  readonly seed?: number;
}

// ── Speech-to-text response (JSON body) ───────────────────────────────

/**
 * One token of a Scribe transcript. `type` distinguishes spoken `word`s from
 * `spacing` and `audio_event` tokens; it is left a free string so an
 * unfamiliar type never fails decoding.
 */
const TranscriptWord = Schema.Struct({
  text: Schema.optional(Schema.NullOr(Schema.String)),
  start: Schema.optional(Schema.NullOr(Schema.Finite)),
  end: Schema.optional(Schema.NullOr(Schema.Finite)),
  type: Schema.optional(Schema.NullOr(Schema.String)),
  speaker_id: Schema.optional(Schema.NullOr(Schema.String)),
});

/** Decoded transcript word/token. */
export type TranscriptWord = typeof TranscriptWord.Type;

/** The decoded body of a `/v1/speech-to-text` response. */
export const SpeechToTextResponse = Schema.Struct({
  language_code: Schema.optional(Schema.NullOr(Schema.String)),
  language_probability: Schema.optional(Schema.NullOr(Schema.Finite)),
  text: Schema.optional(Schema.NullOr(Schema.String)),
  words: Schema.optional(Schema.NullOr(Schema.Array(TranscriptWord))),
});

/** Decoded speech-to-text response type. */
export type SpeechToTextResponse = typeof SpeechToTextResponse.Type;
