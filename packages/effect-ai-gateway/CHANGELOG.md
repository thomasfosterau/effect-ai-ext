# @thomasfosterau/effect-ai-gateway

## 0.5.1

### Patch Changes

- 83e7751: Doc comments on `GatewayBinding.gatewayId`, `GatewayUrlConfig.gatewayId` and the `Binding`, `Anthropic` and `Cohere` module headers no longer name an application's own bindings package or gateway.
- Updated dependencies [8380ae3]
  - @thomasfosterau/effect-ai-ext@0.5.1

## 0.5.0

### Minor Changes

- 132f796: **Breaking:** two changes ship together, so consumers upgrade once.
  
  - **The deprecated `RerankerModel` re-export is removed.** The gateway no longer exports `RerankerModel`, `RerankerUsage`, `RerankedDocument`, `RerankResponse` or `make`, nor the types `RerankOptions`, `ProviderOptions`, `ProviderResponse` and `Service`; each was tagged `@deprecated` in 0.4.x. Import them from `@thomasfosterau/effect-ai-ext/RerankerModel` instead, which exports the same values. `makeCohereReranker` and `makeCohereRerankerFromUrl` are unchanged and still return that module's `Service`.
  - **The optional `@cloudflare/workers-types` peer floor is now `>=4.20250312.0`** (was `>=4`). A Worker's `env.AI` from an older workers-types release is no longer assignable to `GatewayBinding.ai`, because its `AiGateway` lacks `getUrl()`: upgrade `@cloudflare/workers-types` to `4.20250312.0` or later. The gateway's published types no longer reference that package at all (see the `WorkersAiBinding` patch note), so a project that doesn't install it is unaffected.
  
  Also fixes the bundled declarations of `makeCohereReranker` and `makeCohereRerankerFromUrl`: `Cohere.ts` now imports `@thomasfosterau/effect-ai-ext/RerankerModel` directly instead of through the gateway's internal re-export module (deleted), so `dist/index.d.ts` types their result as that module's `Service` again rather than through a `RerankerModel_d_exports` namespace the `vp pack` declaration bundle never declared.
- 52cae13: **Breaking:** the OpenAI moderation models (`makeOpenAiModerationModel`, `makeOpenAiModerationModelFromUrl`) report the provider's `flagged` verdict as `isFlagged`, following `@thomasfosterau/effect-ai-ext`'s `ModerationModel` rename (#98). The wire field is still OpenAI's `flagged`; it is renamed where the response is decoded. Read `result.isFlagged` instead of `result.flagged`.

### Patch Changes

- 8816de6: `cfAigAuthorizationHeader` now declares its return type as the exact header it builds, the new exported `CfAigAuthorizationHeader` type (`{ readonly "cf-aig-authorization": string }`), instead of `Record<string, string>` (#98). The value is unchanged, and the new type is still assignable wherever a `Record<string, string>` is expected.
- 1ad16db: The published declarations no longer name `@cloudflare/workers-types`' ambient `Ai`, `AIGatewayProviders` and `AIGatewayUniversalRequest` globals, which a consumer that type-checks with `skipLibCheck: false` and doesn't install that optional peer saw as TS2304 (#113). The gateway now types them itself, with new exports:
  
  - `WorkersAiBinding` (`gateway(id)` → `WorkersAiGateway`, the `getUrl` / `run` slice the gateway calls) is the type of `GatewayBinding.ai`. A Worker's `env.AI`, typed `Ai` by `@cloudflare/workers-types` `4.20250312.0` or later (the new peer floor, see the breaking note), is assignable to it, so binding callers pass it unchanged.
  - `GatewayProvider` (the known provider slugs, autocompleted, or any string) types the `provider` parameter of `gatewayUrl` and `gatewayBaseUrl`.
  - `GatewayUniversalRequest` types `gatewayRun`'s request, and `GatewayRunOptions` the options it passes to `run()`.
  
  `@cloudflare/workers-types` stays an optional peer, needed only for your own Worker's typing; its floor rises to `>=4.20250312.0` (see the breaking note).
- 99c8d7d: Replace the dead `docs/decisions/effect-ai-gateway.md` citations in the `Anthropic` and `Cohere` module docs with the website issues that record the decisions (website#847, website#472).
- a651e14: Model-id and provider-id parameters are spelled `Model | (string & Record<never, never>)` instead of `Model | (string & {})` (#98). The accepted values are unchanged: any string is still accepted, and the known ids still autocomplete. In `effect-ai-cohere`, the embedding and reranker `model` options, which have no list of known ids, are now plain `string`.
- 79921eb: Build with `vp pack` (tsdown) instead of tsup. Every entry point and subpath keeps the same file name and the same runtime and type exports; only the internal chunk files under `dist/` are named differently, and the bundled declarations name types by their own names instead of minified aliases. The published `src/` is reformatted by Oxfmt with no code change.
- Updated dependencies [52cae13]
- Updated dependencies [132f796]
- Updated dependencies [79921eb]
  - @thomasfosterau/effect-ai-ext@0.5.0

## 0.4.1

### Patch Changes

- f900012: Tested against effect 4.0.0 (with @effect/ai-anthropic and @effect/platform-node 4.0.0); peer floor unchanged.
- Updated dependencies [f900012]
  - @thomasfosterau/effect-ai-ext@0.4.2

## 0.4.0

### Minor Changes

- 601c2c2: **Breaking:** `gatewayUrlConfig` (and every `make…FromUrl` / `…LayerFromUrl` that reads it) no longer defaults `CF_AIG_GATEWAY_ID` to `"website"`. The variable is now required: a missing or empty value fails layer construction with a typed `Config.ConfigError`, like `CF_ACCOUNT_ID` and `CF_AIG_TOKEN`. Consumers that relied on the default must now set `CF_AIG_GATEWAY_ID` explicitly before upgrading.

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

- 1091f13: **Breaking:** the `effect` and `@effect/ai-anthropic` peer dependencies move from the exact `4.0.0-beta.99` pin to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.
  
  - **Fixes the load-time crash on current Effect.** `gatewayUrlConfig` now reads its variables with `Config.String` / `Config.Redacted`. Effect rc.113 renamed these from `Config.string` / `Config.redacted`, so on rc.113 or later, 0.1.x failed as soon as it was imported with `TypeError: Config.string is not a function`.
  - `makeCohereEmbeddingModel` and `makeCohereEmbeddingModelFromUrl` are now typed as `EmbeddingModel.EmbeddingModel`, because rc.113 removed upstream's `EmbeddingModel.Service` alias. The runtime values are unchanged.
  - **Fixes the missing `RerankerModel` runtime exports.** In 0.1.x the bundled `dist/index.js` folded the `RerankerModel` deprecation re-export into an internal object, so `make`, `RerankerModel`, `RerankResponse`, `RerankedDocument` and `RerankerUsage` were in the types but not real ESM exports: `import { make } from "@thomasfosterau/effect-ai-gateway"` threw `SyntaxError: … does not provide an export named 'make'` under Node. They are now re-exported directly from `@thomasfosterau/effect-ai-ext/RerankerModel`. Importing from `@thomasfosterau/effect-ai-ext/RerankerModel` directly remains the recommended path.
- 7336d54: Two new providers, both built on the gateway's universal endpoint:
  
  - **`makeCohereRerankerFromUrl`** — the binding-free sibling of `makeCohereReranker`: a `RerankerModel` backed by Cohere `rerank-v3.5` over the gateway's public HTTPS endpoint (config-resolved `CF_ACCOUNT_ID` / `CF_AIG_GATEWAY_ID` / `CF_AIG_TOKEN`, read once at construction), for a plain Node process, a CLI or CI with no Worker `AI` binding. A plain Effect value (`yield* makeCohereRerankerFromUrl`), since it takes no options.
  - **`OpenAiModeration`** — `makeOpenAiModerationModel(binding, options?)` and `makeOpenAiModerationModelFromUrl(options?)`: a `ModerationModel` (`@thomasfosterau/effect-ai-ext`) backed by OpenAI `omni-moderation-latest`. BYOK by default; `options.apiKey` (a `Redacted`) sends the application's own key as the bearer token; `options.model` overrides the model. The response decode is lenient (unknown vendor fields never fail a valid response; `null` "not assessed" scores are dropped rather than graded as zero) and every failure is an `AiError`.
  
  Internally the Cohere and OpenAI modules now share one request/decode pipeline (`internal/transport.ts`) for both the Worker-binding and HTTPS transports, and each Cohere endpoint builds its request body and maps its response once for both transports. No change to the existing Cohere or Anthropic surface.

### Patch Changes

- 774a352: Fix the `homepage` link in every package manifest: it pointed at a `tree/main/…` path on GitHub, but the repository's default branch is `trunk`, so the link npm shows for each package 404'd. No code changes.
- Updated dependencies [1091f13]
- Updated dependencies [774a352]
  - @thomasfosterau/effect-ai-ext@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [ef67371]
  - @thomasfosterau/effect-ai-ext@0.2.0
