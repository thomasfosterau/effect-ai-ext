---
"@thomasfosterau/effect-ai-gateway": minor
---

**Breaking:** two changes ship together, so consumers upgrade once.

- **The deprecated `RerankerModel` re-export is removed.** The gateway no longer exports `RerankerModel`, `RerankerUsage`, `RerankedDocument`, `RerankResponse` or `make`, nor the types `RerankOptions`, `ProviderOptions`, `ProviderResponse` and `Service`; each was tagged `@deprecated` in 0.4.x. Import them from `@thomasfosterau/effect-ai-ext/RerankerModel` instead, which exports the same values. `makeCohereReranker` and `makeCohereRerankerFromUrl` are unchanged and still return that module's `Service`.
- **The optional `@cloudflare/workers-types` peer now requires `>=4.20260410.1`** (was `>=4`). That is the first release whose `AiGateway` declares both `getUrl()` and the `signal` option on `run()`, which the binding transport uses; on an older release the gateway's own source fails to type-check. Consumers of the binding-based transports should upgrade `@cloudflare/workers-types` before upgrading the gateway. Consumers that use only the `…FromUrl` variants and don't install `@cloudflare/workers-types` are unaffected.

Also fixes the bundled declarations of `makeCohereReranker` and `makeCohereRerankerFromUrl`: `Cohere.ts` now imports `@thomasfosterau/effect-ai-ext/RerankerModel` directly instead of through the gateway's internal re-export module (deleted), so `dist/index.d.ts` types their result as that module's `Service` again rather than through a `RerankerModel_d_exports` namespace the `vp pack` declaration bundle never declared.
