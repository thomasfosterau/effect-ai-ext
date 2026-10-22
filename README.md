# effect-ai-ext

Idiomatic extensions to [Effect](https://effect.website)'s AI module (`effect/ai`): the service abstractions upstream lacks (reranking, classification, speech, transcription, images, moderation, voice conversion), first-party providers for vendors the Effect org doesn't ship, a Cloudflare AI Gateway routing layer, and an Effect-native evaluation toolkit. Everything is purely additive and written to feel like it belongs in `effect/ai` itself: a `Context.Service` tag per capability, `Layer`-based wiring, every failure an `AiError`, `Effect.withSpan` telemetry.

**Status:** experimental and pre-1.0; mostly written by Claude Code. APIs may change between minor versions, so pin what you use.

## Packages

| Package | What it is | Peers |
| --- | --- | --- |
| [`@thomasfosterau/effect-ai-ext`](packages/effect-ai-ext) | Provider-neutral service abstractions: `RerankerModel`, `ClassifierModel`, `SpeechModel`, `TranscriptionModel`, `ImageModel`, `ModerationModel`, `VoiceConversionModel`; one subpath export per module | `effect` |
| [`@thomasfosterau/effect-ai-mistral`](packages/effect-ai-mistral) | Mistral provider: `LanguageModel` over chat completions, streaming and tool calls | `effect` |
| [`@thomasfosterau/effect-ai-cohere`](packages/effect-ai-cohere) | Cohere provider: embed, rerank, classify, chat | `effect` |
| [`@thomasfosterau/effect-ai-voyage`](packages/effect-ai-voyage) | Voyage AI provider: embed, rerank | `effect` |
| [`@thomasfosterau/effect-ai-elevenlabs`](packages/effect-ai-elevenlabs) | ElevenLabs provider: text-to-speech, speech-to-text, voice conversion | `effect` |
| [`@thomasfosterau/effect-ai-gateway`](packages/effect-ai-gateway) | Routes `@effect/ai-anthropic` and gateway-native Cohere / OpenAI moderation through a Cloudflare AI Gateway (Worker binding or public HTTPS endpoint), bring-your-own-key | `effect`, `@effect/ai-anthropic`, optional `@cloudflare/workers-types` |
| [`@thomasfosterau/effect-evals`](packages/effect-evals) | LLM evaluation toolkit: datasets, scorers, thresholds, G-Eval and RAG metrics, a caching runner, and the `effect-evals` CLI | `effect`, optional `@effect/platform-node` (CLI only) |

Each package's README is its API reference.

## Install

Install the packages you need next to `effect`, which must be a single copy in your dependency tree (two copies break `Context`, `Layer` and `Schema` identity):

```sh
pnpm add effect @thomasfosterau/effect-ai-ext @thomasfosterau/effect-ai-voyage
```

The published peer floor is `effect >=4.0.0-rc.118`. Node 22.18 or later, or any runtime with `fetch` (Cloudflare Workers included).

## Example

Rerank documents with Voyage behind the provider-neutral `RerankerModel` service, so the call site never names the vendor:

```ts
import { Config, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RerankerModel } from "@thomasfosterau/effect-ai-ext";
import { VoyageClient, VoyageRerankerModel } from "@thomasfosterau/effect-ai-voyage";

const RerankerLive = VoyageRerankerModel.layer({ model: "rerank-2.5" }).pipe(
  Layer.provide(VoyageClient.layerConfig({ apiKey: Config.Redacted("VOYAGE_API_KEY") })),
  Layer.provide(FetchHttpClient.layer),
);

const program = Effect.gen(function* () {
  const reranker = yield* RerankerModel.RerankerModel;
  const { results } = yield* reranker.rerank({
    query: "what is effect?",
    documents: ["a TypeScript library", "a fruit", "a functional effect system"],
    topN: 2,
  });
  return results;
}).pipe(Effect.provide(RerankerLive));
```

Swapping in Cohere (`CohereRerankerModel`) or the gateway's Cohere route changes only the layer.

Every provider client takes an `apiUrl` override, which is how a routing layer such as the gateway repoints it at a proxy for BYOK.

## Links

- [Changelogs](packages): each package's `CHANGELOG.md`, written by Changesets
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Publishing](PUBLISHING.md)
- [AGENTS.md](AGENTS.md): conventions, commands and verification gates (for humans and coding agents)
- [Issues](https://github.com/thomasfosterau/effect-ai-ext/issues)

## License

[MIT](LICENSE)
