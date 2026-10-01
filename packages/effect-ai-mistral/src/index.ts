/**
 * @module effect-ai-mistral
 *
 * A custom Effect AI provider for Mistral. Effect ships no
 * `@effect/ai-mistral` package, so this package implements the
 * `LanguageModel` service directly against Mistral's OpenAI-compatible
 * `/v1/chat/completions` API:
 *
 * - {@link MistralClient} — the low-level HTTP client (regular + streaming),
 *   with all failures mapped to `AiError`.
 * - {@link MistralLanguageModel} — the `LanguageModel` implementation:
 *   prompt / tool / structured-output conversion and response decoding,
 *   exposed through `layer`, `model`, and `make`.
 *
 * @example
 * ```ts
 * import { Effect, Layer, Redacted } from "effect"
 * import { FetchHttpClient } from "effect/http"
 * import { LanguageModel } from "effect/ai"
 * import { MistralClient, MistralLanguageModel } from "@thomasfosterau/effect-ai-mistral"
 *
 * const ModelLayer = MistralLanguageModel.layer({ model: "mistral-large-latest" }).pipe(
 *   Layer.provide(MistralClient.layer({ apiKey: Redacted.make(process.env.MISTRAL_API_KEY!) })),
 *   Layer.provide(FetchHttpClient.layer),
 * )
 *
 * const program = LanguageModel.generateText({ prompt: "Explain Effect in one line" }).pipe(
 *   Effect.map((response) => response.text),
 *   Effect.provide(ModelLayer),
 * )
 * ```
 */

export * as MistralClient from "./MistralClient";
export * as MistralLanguageModel from "./MistralLanguageModel";
