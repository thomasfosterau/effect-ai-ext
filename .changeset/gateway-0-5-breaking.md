---
"@thomasfosterau/effect-ai-gateway": minor
---

**Breaking:** two changes ship together, so consumers upgrade once.

- **The deprecated `RerankerModel` re-export is removed.** The gateway no longer exports `RerankerModel`, `RerankerUsage`, `RerankedDocument`, `RerankResponse` or `make`, nor the types `RerankOptions`, `ProviderOptions`, `ProviderResponse` and `Service`; each was tagged `@deprecated` in 0.4.x. Import them from `@thomasfosterau/effect-ai-ext/RerankerModel` instead, which exports the same values. `makeCohereReranker` and `makeCohereRerankerFromUrl` are unchanged and still return that module's `Service`.
- **The optional `@cloudflare/workers-types` peer now requires `>=4.20241214.0`** (was `>=4`). That is the first release declaring `AIGatewayProviders` and `AIGatewayUniversalRequest`, which the gateway's published types reference alongside `Ai`; on an older release a consumer type-checking the gateway's declarations gets TS2304. Consumers of the binding-based transports on an older `@cloudflare/workers-types` should upgrade it before upgrading the gateway. Consumers that use only the `…FromUrl` variants need not install it if they set `skipLibCheck: true`; with `skipLibCheck: false`, the gateway's `.d.ts` still names those ambient types (as 0.4.x did), so install `@cloudflare/workers-types` at the floor.

Also fixes the bundled declarations of `makeCohereReranker` and `makeCohereRerankerFromUrl`: `Cohere.ts` now imports `@thomasfosterau/effect-ai-ext/RerankerModel` directly instead of through the gateway's internal re-export module (deleted), so `dist/index.d.ts` types their result as that module's `Service` again rather than through a `RerankerModel_d_exports` namespace the `vp pack` declaration bundle never declared.
