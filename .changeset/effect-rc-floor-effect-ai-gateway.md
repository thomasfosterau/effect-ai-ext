---
"@thomasfosterau/effect-ai-gateway": minor
---

**Breaking:** the `effect` and `@effect/ai-anthropic` peer dependencies move from the exact `4.0.0-beta.99` pin to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.

- **Fixes the load-time crash on current Effect.** `gatewayUrlConfig` now reads its variables with `Config.String` / `Config.Redacted`. Effect rc.113 renamed these from `Config.string` / `Config.redacted`, so on rc.113 or later, 0.1.x failed as soon as it was imported with `TypeError: Config.string is not a function`.
- `makeCohereEmbeddingModel` and `makeCohereEmbeddingModelFromUrl` are now typed as `EmbeddingModel.EmbeddingModel`, because rc.113 removed upstream's `EmbeddingModel.Service` alias. The runtime values are unchanged.
