/**
 * A first-party Effect AI provider for **Voyage AI** (embeddings + rerankers).
 * Effect ships no `@effect/ai-voyage` package, so this package speaks Voyage's
 * own API directly and implements the relevant service abstractions:
 *
 * - {@link VoyageClient} — the low-level HTTP client for `/v1/embeddings` and
 *   `/v1/rerank`, with all failures mapped to `AiError`. Its `apiUrl` override
 *   lets a routing layer (the Cloudflare AI Gateway) repoint it for BYOK.
 * - {@link VoyageEmbeddingModel} — `effect/ai`'s `EmbeddingModel`,
 *   with the current model/dimension matrix exposed as constants.
 * - {@link VoyageRerankerModel} — `@thomasfosterau/effect-ai-ext`'s
 *   `RerankerModel`.
 *
 * @example
 * ```ts
 * import { Effect, Layer, Redacted } from "effect"
 * import { FetchHttpClient } from "effect/http"
 * import { EmbeddingModel } from "effect/ai"
 * import { VoyageClient, VoyageEmbeddingModel } from "@thomasfosterau/effect-ai-voyage"
 *
 * const ModelLayer = VoyageEmbeddingModel.layer({
 *   model: "voyage-3-large",
 *   inputType: "document",
 * }).pipe(
 *   Layer.provide(VoyageClient.layer({ apiKey: Redacted.make(process.env.VOYAGE_API_KEY!) })),
 *   Layer.provide(FetchHttpClient.layer),
 * )
 *
 * const program = Effect.flatMap(EmbeddingModel.EmbeddingModel, (model) =>
 *   model.embed("Explain Effect in one line"),
 * ).pipe(
 *   Effect.map((response) => response.vector),
 *   Effect.provide(ModelLayer),
 * )
 * ```
 *
 * @module effect-ai-voyage
 */

export * as VoyageClient from "./VoyageClient";
export * as VoyageEmbeddingModel from "./VoyageEmbeddingModel";
export * as VoyageRerankerModel from "./VoyageRerankerModel";
