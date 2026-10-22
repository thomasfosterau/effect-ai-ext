# @thomasfosterau/effect-ai-ext

The provider-neutral half of the family: the AI service abstractions `effect/ai` lacks (`RerankerModel`, `ClassifierModel`, `SpeechModel`, `TranscriptionModel`, `ImageModel`, `ModerationModel`, `VoiceConversionModel`), each written as if it could merge into `effect/ai`, plus a barrel that re-exports every upstream `effect/ai` module beside them. No HTTP, no provider code.

## Boundary

Peer: `effect` only. Imports nothing from this workspace (`.fallowrc.json` zone `ext`, no outbound rule); the provider packages and the gateway import it. One subpath export per module, each built from a one-line facade under `entries/` (the package's `vite.config.ts` says why); a new module adds its facade, its `exports` / `publishConfig.exports` entry, its `.fallowrc.json` entry (covered by `src/*Model.ts`) and its barrel line.

## Invariants

- **Every module mirrors `effect/ai`'s `EmbeddingModel`**: a `Context.Service` tag keyed `@thomasfosterau/effect-ai-ext/<Module>`, a `Service` interface, caller `*Options` vs normalised `ProviderOptions` / `ProviderResponse`, `Schema.Class` response and usage models, and a `make(...)` that validates the provider's result and wraps each operation in `Effect.withSpan("<Module>.<operation>")`. `RerankerModel.ts` is the reference.
- **Operations fail only with `AiError`.** A provider result that breaks the contract (an out-of-range or duplicate rerank index, a missing classification, a label outside the caller's set, a moderation score outside `[0, 1]`, empty audio, a segment with `end < start`) fails with an `AiError` whose reason is `InvalidOutputError`, never a defect.
- **Empty input never reaches the provider**: `rerank` with no documents, `classify` / `moderate` with no inputs return an empty response without calling it.
- **`fromLanguageModel` adapters reuse `make`.** `ClassifierModel.fromLanguageModel` and `ModerationModel.fromLanguageModel` prompt through `LanguageModel.generateObject` and feed the decoded value through the same `make` validation as a native provider.
- **The barrel's upstream re-export is `export * from "effect/ai"`**: same identities, nothing wrapped. A future upstream module whose name collides with one here surfaces as a build error, the signal to adopt upstream and drop the local module.
