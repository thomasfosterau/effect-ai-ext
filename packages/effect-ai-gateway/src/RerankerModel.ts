/**
 * @module RerankerModel
 *
 * **Moved.** `RerankerModel` now lives in
 * `@thomasfosterau/effect-ai-ext/RerankerModel` — a reranker abstraction never
 * belonged in a routing package. This module is a re-export shim kept for a
 * deprecation window so existing `@thomasfosterau/effect-ai-gateway` imports
 * (and `Cohere.ts`'s `makeCohereReranker`) keep working; it will be removed in
 * a future release. Import from `@thomasfosterau/effect-ai-ext` instead.
 */

export * from "@thomasfosterau/effect-ai-ext/RerankerModel";
