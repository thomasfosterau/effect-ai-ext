---
"@thomasfosterau/effect-ai-ext": minor
"@thomasfosterau/effect-ai-gateway": minor
"@thomasfosterau/effect-ai-mistral": minor
"@thomasfosterau/effect-ai-cohere": minor
"@thomasfosterau/effect-ai-voyage": minor
"@thomasfosterau/effect-ai-elevenlabs": minor
"@thomasfosterau/effect-evals": minor
---

**Breaking:** require `effect@>=4.0.0-rc.118` (and `@effect/ai-anthropic` / `@effect/platform-node` `>=4.0.0-rc.118` where peered). Effect rc.118 moved every `effect/unstable/*` module to `effect/*` (for example `effect/unstable/ai/LanguageModel` is now `effect/ai/LanguageModel`), so published builds now import the new paths and no longer resolve against earlier rcs. Upgrade `effect` and its `@effect/*` companions together. Cohere and Mistral encode image data URIs with `effect/encoding/Base64` (the `effect/Encoding` module was split in rc.118).
