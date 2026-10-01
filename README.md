# effect-ai-ext

Idiomatic extensions to Effect's AI package(s). More providers, richer
service abstractions, purely additive — written to feel like they belong in
`effect/ai` itself.

This is the monorepo home of the `@thomasfosterau/effect-ai-*` family.

## Packages

| Package | What it is | Status |
| --- | --- | --- |
| [`@thomasfosterau/effect-ai-ext`](packages/effect-ai-ext) | Provider-neutral AI service abstractions upstream Effect lacks (reranker, classifier, TTS, STT, image, moderation, voice conversion) | published-ready |
| [`@thomasfosterau/effect-ai-mistral`](packages/effect-ai-mistral) | First-party Mistral provider (`LanguageModel` over chat completions) | published-ready |
| [`@thomasfosterau/effect-ai-gateway`](packages/effect-ai-gateway) | Route Effect AI providers through a Cloudflare AI Gateway Worker binding (BYOK) | published-ready |
| [`@thomasfosterau/effect-ai-cohere`](packages/effect-ai-cohere) | First-party Cohere provider (embed, rerank, classify, chat) | published-ready |
| [`@thomasfosterau/effect-ai-voyage`](packages/effect-ai-voyage) | First-party Voyage AI provider (embed, rerank) | published-ready |
| [`@thomasfosterau/effect-ai-elevenlabs`](packages/effect-ai-elevenlabs) | First-party ElevenLabs provider (TTS, STT, voice conversion) | published-ready |
| [`@thomasfosterau/effect-evals`](packages/effect-evals) | Effect-native LLM evaluation toolkit — goldens, scorers, thresholds, G-Eval/RAG metrics, a caching runner, and an `effect-evals` CLI | unpublished |

## Design

- **Routing layers vs first-party providers.** `effect-ai-gateway` is
  Cloudflare's AI Gateway product (BYOK, binding-routed); provider packages
  speak first-party APIs and are portable — a routing layer repoints their
  clients via the `apiUrl` override.
- **Upstream boundary.** No local packages for providers the Effect org
  covers (`@effect/ai-anthropic` today) — repoint the upstream package.
- **Upstream-shaped abstractions.** Every `effect-ai-ext` module is written as
  if it could merge into `effect/ai`.

## Development

```sh
pnpm install        # pnpm 11 (Corepack); installs + patches the native TypeScript compiler
pnpm run check      # type-check every package (native TS7 tsc)
pnpm run test       # unit tests (vitest; stubbed fixtures, no live network)
pnpm run build      # build publishable dist for every package (tsup)
pnpm run ci         # all three
```

See [AGENTS.md](AGENTS.md) for toolchain details (the TypeScript 6/7 split),
package archetypes, and conventions.

## License

MIT
