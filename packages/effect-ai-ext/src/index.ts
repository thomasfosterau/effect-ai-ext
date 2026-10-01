/**
 * Provider-neutral AI service _abstractions_ that upstream Effect
 * (`effect/ai`) does not yet ship. Each module is written as if it
 * could merge into `effect/ai` itself — a `Context.Service` tag, a
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
 *
 * For convenience this barrel is a **superset** of `effect/ai`: it
 * re-exports every upstream AI module (`LanguageModel`, `EmbeddingModel`,
 * `AiError`, `Tool`, `Toolkit`, `Chat`, `Prompt`, `Response`, `Model`,
 * `Tokenizer`, `Telemetry`, `IdGenerator`, …) alongside the abstractions above,
 * so a single import reaches the whole AI service surface — upstream and
 * extension:
 *
 * @example
 * ```ts
 * import { LanguageModel, EmbeddingModel, RerankerModel } from "@thomasfosterau/effect-ai-ext"
 * ```
 *
 * These re-exports are the same identities as `effect/ai` (`effect` is
 * a peer dependency, one singleton copy), so mixing the two import styles is
 * safe. To take the upstream modules straight from `effect`, import from
 * `effect/ai` — nothing here shadows or wraps them.
 *
 * @module effect-ai-ext
 */

// The extension abstractions.
export * as RerankerModel from "./RerankerModel";
export * as ClassifierModel from "./ClassifierModel";
export * as SpeechModel from "./SpeechModel";
export * as TranscriptionModel from "./TranscriptionModel";
export * as ImageModel from "./ImageModel";
export * as ModerationModel from "./ModerationModel";
export * as VoiceConversionModel from "./VoiceConversionModel";

// Re-export Effect's upstream AI modules so this barrel is the whole surface.
// The names are disjoint from the abstractions above; a future upstream module
// that collides would surface here as a build error, signalling it's time to
// adopt upstream and drop the local one.
export * from "effect/ai";
