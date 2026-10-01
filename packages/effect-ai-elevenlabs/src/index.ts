/**
 * A custom Effect AI provider for ElevenLabs — the audio leg of the
 * `@thomasfosterau/effect-ai-*` family. Effect ships no ElevenLabs package, so
 * this package implements `effect-ai-ext`'s audio abstractions directly against
 * the ElevenLabs API:
 *
 * - {@link ElevenLabsClient} — the low-level HTTP client (binary and streaming
 *   audio, multipart uploads), with all failures mapped to `AiError`.
 * - {@link ElevenLabsSpeechModel} — `SpeechModel` (text-to-speech): one-shot
 *   bytes and a backpressured, interruption-safe streaming surface.
 * - {@link ElevenLabsTranscriptionModel} — `TranscriptionModel` over Scribe
 *   (speech-to-text) with per-word segment timestamps and language detection.
 * - {@link ElevenLabsVoiceConversionModel} — `VoiceConversionModel`
 *   (speech-to-speech).
 *
 * @example
 * ```ts
 * import { Effect, Layer, Redacted } from "effect"
 * import { FetchHttpClient } from "effect/http"
 * import { SpeechModel } from "@thomasfosterau/effect-ai-ext"
 * import { ElevenLabsClient, ElevenLabsSpeechModel } from "@thomasfosterau/effect-ai-elevenlabs"
 *
 * const SpeechLayer = ElevenLabsSpeechModel.layer({
 *   voiceId: "21m00Tcm4TlvDq8ikWAM",
 *   modelId: "eleven_multilingual_v2",
 * }).pipe(
 *   Layer.provide(ElevenLabsClient.layer({ apiKey: Redacted.make(process.env.ELEVENLABS_API_KEY!) })),
 *   Layer.provide(FetchHttpClient.layer),
 * )
 *
 * const program = Effect.gen(function* () {
 *   const speech = yield* SpeechModel.SpeechModel
 *   // Backpressured audio chunks — never buffered whole:
 *   return speech.stream({ text: "Hello from Effect" })
 * }).pipe(Effect.provide(SpeechLayer))
 * ```
 *
 * @module effect-ai-elevenlabs
 */

export * as ElevenLabsClient from "./ElevenLabsClient";
export * as ElevenLabsSpeechModel from "./ElevenLabsSpeechModel";
export * as ElevenLabsTranscriptionModel from "./ElevenLabsTranscriptionModel";
export * as ElevenLabsVoiceConversionModel from "./ElevenLabsVoiceConversionModel";
