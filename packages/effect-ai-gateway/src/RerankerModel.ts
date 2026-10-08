/**
 * **Moved.** `RerankerModel` now lives in
 * `@thomasfosterau/effect-ai-ext/RerankerModel` — a reranker abstraction never
 * belonged in a routing package. This module is a re-export shim kept for a
 * deprecation window so existing `@thomasfosterau/effect-ai-gateway` imports
 * (and `Cohere.ts`'s `makeCohereReranker`) keep working. The gateway's
 * `RerankerModel` re-export is `@deprecated` and is removed in 0.5.0; import
 * from `@thomasfosterau/effect-ai-ext/RerankerModel` instead.
 *
 * @module RerankerModel
 */

export * from "@thomasfosterau/effect-ai-ext/RerankerModel";
