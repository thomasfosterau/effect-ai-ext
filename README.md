# effect-ai-ext

Idiomatic extensions to Effect's AI module (`effect/ai`): more providers and richer service abstractions, purely additive and written to feel like they belong in `effect/ai` itself. This is the monorepo home of the `@thomasfosterau/effect-ai-*` family and `@thomasfosterau/effect-evals`.

## Packages

| Package | What it is |
| --- | --- |
| [`@thomasfosterau/effect-ai-ext`](packages/effect-ai-ext) | Provider-neutral AI service abstractions upstream Effect lacks (reranker, classifier, TTS, STT, image, moderation, voice conversion) |
| [`@thomasfosterau/effect-ai-mistral`](packages/effect-ai-mistral) | First-party Mistral provider (`LanguageModel` over chat completions) |
| [`@thomasfosterau/effect-ai-gateway`](packages/effect-ai-gateway) | Route Effect AI providers through a Cloudflare AI Gateway Worker binding or its public HTTPS endpoint (BYOK) |
| [`@thomasfosterau/effect-ai-cohere`](packages/effect-ai-cohere) | First-party Cohere provider (embed, rerank, classify, chat) |
| [`@thomasfosterau/effect-ai-voyage`](packages/effect-ai-voyage) | First-party Voyage AI provider (embed, rerank) |
| [`@thomasfosterau/effect-ai-elevenlabs`](packages/effect-ai-elevenlabs) | First-party ElevenLabs provider (TTS, STT, voice conversion) |
| [`@thomasfosterau/effect-evals`](packages/effect-evals) | Effect-native LLM evaluation toolkit — goldens, scorers, thresholds, G-Eval/RAG metrics, a caching runner, and an `effect-evals` CLI |

## Development

See [AGENTS.md](AGENTS.md#commands) for the commands, gates and conventions, and [PUBLISHING.md](PUBLISHING.md) for releases.

## License

MIT
