---
"@thomasfosterau/effect-ai-ext": minor
---

The package barrel is now a superset of `effect/unstable/ai`: it re-exports
every upstream AI module (`LanguageModel`, `EmbeddingModel`, `AiError`,
`Tool`/`Toolkit`, `Chat`, `Prompt`/`Response`, `Model`, `Tokenizer`,
`Telemetry`, `IdGenerator`, …) alongside the extension abstractions, so a single
import reaches the whole AI service surface:

```ts
import { LanguageModel, EmbeddingModel, RerankerModel } from "@thomasfosterau/effect-ai-ext"
```

The re-exports are the same identities as `effect/unstable/ai` (one singleton
`effect` peer), so mixing import styles is safe. Purely additive — the per-module
subpaths and existing exports are unchanged.
