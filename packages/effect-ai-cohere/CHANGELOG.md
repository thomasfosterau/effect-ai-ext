# @thomasfosterau/effect-ai-cohere

## 0.3.5

### Patch Changes

- Updated dependencies [db7a951]
  - @thomasfosterau/effect-ai-ext@0.6.0

## 0.3.4

### Patch Changes

- 8380ae3: Internal refactor to the Effect lint plugin 0.6.0 rules: native loops, `JSON`, `Map` / `Set` and `Object.*` helpers replaced with `effect/Array`, `effect/Record`, `HashSet` / `MutableHashMap` and Schema JSON codecs. Request bodies, decoded results and error messages are unchanged.
- Updated dependencies [8380ae3]
  - @thomasfosterau/effect-ai-ext@0.5.1

## 0.3.3

### Patch Changes

- 13a7edd: Streamed frames and tool-call arguments are parsed with `Schema.fromJsonString(Schema.Json)` instead of a `try`/`catch` around `JSON.parse` (#98). Text that is not JSON is still handed on as the raw string, as before. The one difference is a number literal too large for a finite double (`1e400`), which `JSON.parse` turned into `Infinity`: such text is no longer treated as JSON and is handed on as the raw string.
  
  An SSE frame containing such a literal therefore fails schema decoding, so the stream fails with an `AiError`, as any other malformed frame does.
- 00c8f92: `toolChoice: "none"` now sends the tool definitions with `tool_choice: "NONE"`, so the model sees the tools but cannot call them. Previously it dropped `tools` and `tool_choice` from the `/v2/chat` request body entirely (#121). A request without a toolkit still sends neither field. `NONE` (like `REQUIRED`) is only accepted by Command R7B and newer models; the module header, the `Model` doc comment and the README now say so, and advise `toolChoice: "auto"` on older models (`command-r`, `command-r-plus`).
- a651e14: Model-id and provider-id parameters are spelled `Model | (string & Record<never, never>)` instead of `Model | (string & {})` (#98). The accepted values are unchanged: any string is still accepted, and the known ids still autocomplete. In `effect-ai-cohere`, the embedding and reranker `model` options, which have no list of known ids, are now plain `string`.
- 79921eb: Build with `vp pack` (tsdown) instead of tsup. Every entry point and subpath keeps the same file name and the same runtime and type exports; only the internal chunk files under `dist/` are named differently, and the bundled declarations name types by their own names instead of minified aliases. The published `src/` is reformatted by Oxfmt with no code change.
- Updated dependencies [52cae13]
- Updated dependencies [132f796]
- Updated dependencies [79921eb]
  - @thomasfosterau/effect-ai-ext@0.5.0

## 0.3.2

### Patch Changes

- f900012: Tested against effect 4.0.0 (with @effect/ai-anthropic and @effect/platform-node 4.0.0); peer floor unchanged.
- Updated dependencies [f900012]
  - @thomasfosterau/effect-ai-ext@0.4.2

## 0.3.1

### Patch Changes

- 15080ed: Documentation only. Doc comments now open with their summary (module headers no longer start with `@module` or `@copyright`, so editor hovers show it), the misleading `@since 4.0.0` tags are gone (no 4.0.0 of these packages exists), and comments that cite another repository's issues and decision records say so (`website#NNN`). The `effect-ai-gateway` README examples compile and its barrel has a summary; the `effect-evals` README gains an Install section and the modules its table omitted.
- Updated dependencies [15080ed]
  - @thomasfosterau/effect-ai-ext@0.4.1

## 0.3.0

### Minor Changes

- 3a3db62: **Breaking:** require `effect@>=4.0.0-rc.118` (and `@effect/ai-anthropic` / `@effect/platform-node` `>=4.0.0-rc.118` where peered). Effect rc.118 moved every `effect/unstable/*` module to `effect/*` (for example `effect/unstable/ai/LanguageModel` is now `effect/ai/LanguageModel`), so published builds now import the new paths and no longer resolve against earlier rcs. Upgrade `effect` and its `@effect/*` companions together. Cohere and Mistral encode image data URIs with `effect/encoding/Base64` (the `effect/Encoding` module was split in rc.118).

### Patch Changes

- Updated dependencies [3a3db62]
  - @thomasfosterau/effect-ai-ext@0.4.0

## 0.2.0

### Minor Changes

- 1091f13: **Breaking:** the `effect` peer dependency moves from the exact `4.0.0-beta.99` pin to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.
  
  - **Streaming SSE failures are now `AiError`s.** In the rc line, `Sse.decode()` can fail with `Sse.SseError` (`EventTooLarge`, an event over the decoder's 10 MiB cap). The chat stream now maps that to an `AiError` with an `InvalidOutputError` reason, which is how the upstream Effect providers classify it, so no raw decoder error leaks out of `streamText`.
  - `CohereLanguageModel.make` and `CohereEmbeddingModel.make` are now typed as `LanguageModel.LanguageModel` and `EmbeddingModel.EmbeddingModel`, because rc.113 removed upstream's `Service` aliases. The runtime values are unchanged.

### Patch Changes

- 774a352: Fix the `homepage` link in every package manifest: it pointed at a `tree/main/…` path on GitHub, but the repository's default branch is `trunk`, so the link npm shows for each package 404'd. No code changes.
- Updated dependencies [1091f13]
- Updated dependencies [774a352]
  - @thomasfosterau/effect-ai-ext@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [ef67371]
  - @thomasfosterau/effect-ai-ext@0.2.0
