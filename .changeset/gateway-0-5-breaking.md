---
"@thomasfosterau/effect-ai-gateway": minor
---

**Breaking:** two changes ship together, so consumers upgrade once.

- **The deprecated `RerankerModel` re-export is removed.** The gateway no longer exports `RerankerModel`, `RerankerUsage`, `RerankedDocument`, `RerankResponse` or `make`, nor the types `RerankOptions`, `ProviderOptions`, `ProviderResponse` and `Service`; each was tagged `@deprecated` in 0.4.x. Import them from `@thomasfosterau/effect-ai-ext/RerankerModel` instead, which exports the same values. `makeCohereReranker` and `makeCohereRerankerFromUrl` are unchanged and still return that module's `Service`.
- **The optional `@cloudflare/workers-types` peer floor is now `>=4.20250312.0`** (was `>=4`). A Worker's `env.AI` from an older workers-types release is no longer assignable to `GatewayBinding.ai`, because its `AiGateway` lacks `getUrl()`: upgrade `@cloudflare/workers-types` to `4.20250312.0` or later. The gateway's published types no longer reference that package at all (see the `WorkersAiBinding` patch note), so a project that doesn't install it is unaffected.

Also fixes the bundled declarations of `makeCohereReranker` and `makeCohereRerankerFromUrl`: `Cohere.ts` now imports `@thomasfosterau/effect-ai-ext/RerankerModel` directly instead of through the gateway's internal re-export module (deleted), so `dist/index.d.ts` types their result as that module's `Service` again rather than through a `RerankerModel_d_exports` namespace the `vp pack` declaration bundle never declared.
