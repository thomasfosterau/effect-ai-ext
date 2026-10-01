/**
 * A first-party Effect AI provider for Cohere. Effect ships no
 * `@effect/ai-cohere` package, so this package implements each capability
 * directly against Cohere's v2 API:
 *
 * - {@link CohereClient} — the low-level HTTP client for `/v2/chat` (regular
 *   and streaming), `/v2/embed`, and `/v2/rerank`, with every failure mapped
 *   to `AiError`. Its `apiUrl` override is the BYOK routing contract used by
 *   the Cloudflare AI Gateway package.
 * - {@link CohereLanguageModel} — the `LanguageModel` implementation over
 *   Command chat models: prompt / tool / structured-output conversion and
 *   response decoding, exposed through `layer`, `model`, and `make`.
 * - {@link CohereEmbeddingModel} — the `EmbeddingModel` implementation over
 *   `embed-v4.0` (pinned model + output dimension).
 * - {@link CohereRerankerModel} — the effect-ai-ext `RerankerModel`
 *   implementation over `rerank-v3.5`.
 * - {@link CohereClassifierModel} — the effect-ai-ext `ClassifierModel`
 *   implementation, backed by Cohere chat + structured output (Cohere's
 *   dedicated Classify surface is v1-legacy; see the module for the rationale).
 *
 * @example
 * ```ts
 * import { Effect, Layer, Redacted } from "effect"
 * import { FetchHttpClient } from "effect/http"
 * import { LanguageModel } from "effect/ai"
 * import { CohereClient, CohereLanguageModel } from "@thomasfosterau/effect-ai-cohere"
 *
 * const ModelLayer = CohereLanguageModel.layer({ model: "command-a-03-2025" }).pipe(
 *   Layer.provide(CohereClient.layer({ apiKey: Redacted.make(process.env.COHERE_API_KEY!) })),
 *   Layer.provide(FetchHttpClient.layer),
 * )
 *
 * const program = LanguageModel.generateText({ prompt: "Explain Effect in one line" }).pipe(
 *   Effect.map((response) => response.text),
 *   Effect.provide(ModelLayer),
 * )
 * ```
 *
 * @module effect-ai-cohere
 */

export * as CohereClient from "./CohereClient";
export * as CohereLanguageModel from "./CohereLanguageModel";
export * as CohereEmbeddingModel from "./CohereEmbeddingModel";
export * as CohereRerankerModel from "./CohereRerankerModel";
export * as CohereClassifierModel from "./CohereClassifierModel";
