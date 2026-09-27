---
"@thomasfosterau/effect-ai-voyage": minor
---

**Breaking:** the `effect` peer dependency moves from the exact `4.0.0-beta.99` pin to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.

`VoyageEmbeddingModel.make` is now typed as `EmbeddingModel.EmbeddingModel`, because rc.113 removed upstream's `EmbeddingModel.Service` alias. The runtime value is unchanged.
