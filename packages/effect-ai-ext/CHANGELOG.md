# @thomasfosterau/effect-ai-ext

## 0.3.0

### Minor Changes

- 1091f13: **Breaking:** the `effect` peer dependency moves from the exact `4.0.0-beta.99` pin to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.
  
  No API changes. The `effect/unstable/ai` re-export now follows the rc surface. For example, the `LanguageModel` and `EmbeddingModel` service shapes are the module-named interfaces (`LanguageModel.LanguageModel`); rc.113 removed the `Service` aliases.

### Patch Changes

- 774a352: Fix the `homepage` link in every package manifest: it pointed at a `tree/main/…` path on GitHub, but the repository's default branch is `trunk`, so the link npm shows for each package 404'd. No code changes.

## 0.2.0

### Minor Changes

- ef67371: The package barrel is now a superset of `effect/unstable/ai`: it re-exports
  every upstream AI module (`LanguageModel`, `EmbeddingModel`, `AiError`,
  `Tool`/`Toolkit`, `Chat`, `Prompt`/`Response`, `Model`, `Tokenizer`,
  `Telemetry`, `IdGenerator`, …) alongside the extension abstractions, so a single
  import reaches the whole AI service surface:

  ```ts
  import {
    LanguageModel,
    EmbeddingModel,
    RerankerModel,
  } from "@thomasfosterau/effect-ai-ext";
  ```

  The re-exports are the same identities as `effect/unstable/ai` (one singleton
  `effect` peer), so mixing import styles is safe. Purely additive — the per-module
  subpaths and existing exports are unchanged.
