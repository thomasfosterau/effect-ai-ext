/**
 * @module effect-ai-ext
 *
 * Provider-neutral AI service _abstractions_ that upstream Effect
 * (`effect/unstable/ai`) does not yet ship. Each module is written as if it
 * could merge into `effect/unstable/ai` itself — a `Context.Service` tag, a
 * `Service` interface, a `make(...)` that validates provider results, a typed
 * `AiError` channel, and `Effect.withSpan` instrumentation — exactly like
 * `EmbeddingModel`.
 *
 * - {@link RerankerModel} — reorder documents by relevance to a query.
 * - {@link ClassifierModel} — assign labelled classes with confidences.
 * - {@link SpeechModel} — text-to-speech (one-shot and streaming).
 * - {@link TranscriptionModel} — speech-to-text with optional segments.
 * - {@link ImageModel} — generate images from a prompt.
 * - {@link ModerationModel} — score content against policy categories.
 * - {@link VoiceConversionModel} — re-voice audio into a target voice.
 *
 * `ClassifierModel` and `ModerationModel` additionally expose a
 * `fromLanguageModel` adapter that backs the abstraction with any
 * `LanguageModel` through structured-output prompting.
 *
 * Every module is also available as a per-module subpath (mirroring how
 * `effect` itself ships), e.g. `@thomasfosterau/effect-ai-ext/RerankerModel`.
 */

export * as RerankerModel from "./RerankerModel";
export * as ClassifierModel from "./ClassifierModel";
export * as SpeechModel from "./SpeechModel";
export * as TranscriptionModel from "./TranscriptionModel";
export * as ImageModel from "./ImageModel";
export * as ModerationModel from "./ModerationModel";
export * as VoiceConversionModel from "./VoiceConversionModel";
