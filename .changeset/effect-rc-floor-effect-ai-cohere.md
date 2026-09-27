---
"@thomasfosterau/effect-ai-cohere": minor
---

**Breaking:** the `effect` peer dependency moves from the exact `4.0.0-beta.99` pin to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.

- **Streaming SSE failures are now `AiError`s.** In the rc line, `Sse.decode()` can fail with `Sse.SseError` (`EventTooLarge`, an event over the decoder's 10 MiB cap). The chat stream now maps that to an `AiError` with an `InvalidOutputError` reason, which is how the upstream Effect providers classify it, so no raw decoder error leaks out of `streamText`.
- `CohereLanguageModel.make` and `CohereEmbeddingModel.make` are now typed as `LanguageModel.LanguageModel` and `EmbeddingModel.EmbeddingModel`, because rc.113 removed upstream's `Service` aliases. The runtime values are unchanged.
