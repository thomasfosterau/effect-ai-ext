---
"@thomasfosterau/effect-ai-gateway": patch
---

Mark the `RerankerModel` re-export `@deprecated`, removed in 0.5.0. Each name the gateway re-exports from `@thomasfosterau/effect-ai-ext/RerankerModel` (`RerankerModel`, `RerankerUsage`, `RerankedDocument`, `RerankResponse`, `make`, and the types `RerankOptions`, `ProviderOptions`, `ProviderResponse`, `Service`) now carries its own `@deprecated` tag in the published `.d.ts`, so editors strike the gateway import through. The values are the same objects as before; import them from `@thomasfosterau/effect-ai-ext/RerankerModel` instead.
