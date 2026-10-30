# @thomasfosterau/effect-ai-ext

## 0.6.0

### Minor Changes

- db7a951: `ModerationModel` can screen images and report more of the provider's reading (#143).
  
  - **Multimodal inputs.** `ModerationOptions.inputs` (and `ProviderOptions.inputs`) take `ModerationInput`: a string, or an array of `effect/ai` user-message parts (`Prompt.UserMessagePartEncoded`, text and file) screened as one input. An empty part list fails with `AiError.InvalidUserInputError`. Breaking for provider implementations, which must now accept the wider input type; callers that pass strings are unaffected. `fromLanguageModel` sends a multimodal batch as a system message of instructions and a user message of parts, every caller text part JSON-quoted like a string input.
  - **Per-category flags.** `ModerationResult.flags?: Record<string, boolean>` carries the provider's own verdict per category; the OpenAI provider fills it from `categories` (nulls dropped).
  - **Resolved model id.** `ModerationResponse.modelId?: string` names the model that served the call (OpenAI's dated snapshot; a `LanguageModel`'s response metadata for `fromLanguageModel`).
  - **Call ledger.** `OpenAiModerationOptions.onCall` observes each HTTP call's `status`, `durationMillis` and `error` (`OpenAiModerationCall`), on success and failure, on both transports.
  - The OpenAI provider sends image file parts as `image_url` parts, one request per multimodal input; a non-image file part fails with `AiError.InvalidUserInputError` before any request.

## 0.5.1

### Patch Changes

- 8380ae3: Internal refactor to the Effect lint plugin 0.6.0 rules: native loops, `JSON`, `Map` / `Set` and `Object.*` helpers replaced with `effect/Array`, `effect/Record`, `HashSet` / `MutableHashMap` and Schema JSON codecs. Request bodies, decoded results and error messages are unchanged.

## 0.5.0

### Minor Changes

- 52cae13: **Breaking:** `ModerationModel`'s boolean verdict is renamed from `flagged` to `isFlagged` (#98), following the Effect lint preset's boolean-prefix convention. Both `ModerationResult.isFlagged` and the `ProviderResponse` contract a provider hands `ModerationModel.make` now use the new name: read `result.isFlagged` instead of `result.flagged`, and have a custom provider return `{ isFlagged, categories }`. `fromLanguageModel` still asks the model for a `flagged` field (the moderation APIs' own name) and decodes it to `isFlagged`. `ModerationResult`'s own Schema-encoded form uses `isFlagged` too, so a previously encoded `ModerationResult` / `ModerationResponse` (for example in a cache) holding `flagged` no longer decodes.

### Patch Changes

- 132f796: README: the "`RerankerModel` moved here" section now says the gateway's deprecated re-export was removed in effect-ai-gateway 0.5.0, so `@thomasfosterau/effect-ai-ext/RerankerModel` is the only import path.
- 79921eb: Build with `vp pack` (tsdown) instead of tsup. Every entry point and subpath keeps the same file name and the same runtime and type exports; only the internal chunk files under `dist/` are named differently, and the bundled declarations name types by their own names instead of minified aliases. The published `src/` is reformatted by Oxfmt with no code change.

## 0.4.2

### Patch Changes

- f900012: Tested against effect 4.0.0 (with @effect/ai-anthropic and @effect/platform-node 4.0.0); peer floor unchanged.

## 0.4.1

### Patch Changes

- 15080ed: Documentation only. Doc comments now open with their summary (module headers no longer start with `@module` or `@copyright`, so editor hovers show it), the misleading `@since 4.0.0` tags are gone (no 4.0.0 of these packages exists), and comments that cite another repository's issues and decision records say so (`website#NNN`). The `effect-ai-gateway` README examples compile and its barrel has a summary; the `effect-evals` README gains an Install section and the modules its table omitted.

## 0.4.0

### Minor Changes

- 3a3db62: **Breaking:** require `effect@>=4.0.0-rc.118` (and `@effect/ai-anthropic` / `@effect/platform-node` `>=4.0.0-rc.118` where peered). Effect rc.118 moved every `effect/unstable/*` module to `effect/*` (for example `effect/unstable/ai/LanguageModel` is now `effect/ai/LanguageModel`), so published builds now import the new paths and no longer resolve against earlier rcs. Upgrade `effect` and its `@effect/*` companions together. Cohere and Mistral encode image data URIs with `effect/encoding/Base64` (the `effect/Encoding` module was split in rc.118).

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
