# @thomasfosterau/effect-ai-ext

Provider-neutral AI service **abstractions** that upstream Effect
(`effect/unstable/ai`) does not yet ship. `effect/unstable/ai` gives you
`LanguageModel`, `EmbeddingModel`, `Tokenizer`, `Tool`/`Toolkit`, `Chat`,
`Prompt`/`Response`, `Model`, `AiError`, and `Telemetry` — and nothing for
reranking, classification, speech, transcription, image generation, moderation,
or voice conversion.

This package fills that gap in upstream's own idiom. Every module is written **as
if it could merge into `effect/unstable/ai` itself** — the same shape as
`EmbeddingModel`:

- a `Context.Service` tag (`@thomasfosterau/effect-ai-ext/<Module>`),
- `Schema.Class` response/usage models,
- caller `Options` vs normalised `ProviderOptions`/`ProviderResponse` contracts,
- a `Service` interface whose operations fail only through `AiError`,
- a `make(...)` constructor that **validates** provider results before handing
  them back, wrapping each operation in `Effect.withSpan`.

No provider code, no HTTP — abstractions only. First-party provider packages
(Cohere, Voyage, ElevenLabs, …) implement these services the same way
`effect-ai-mistral` implements `LanguageModel`.

## Install

```sh
pnpm add @thomasfosterau/effect-ai-ext effect
```

`effect` is a peer dependency (it must stay a singleton).

## Modules & their upstream-merge story

Each module is also available as a per-module subpath (mirroring how `effect`
itself ships), e.g. `@thomasfosterau/effect-ai-ext/RerankerModel`.

| Module | Operation(s) | If it merged upstream |
| --- | --- | --- |
| `RerankerModel` | `rerank` | `effect/unstable/ai/RerankerModel` — the sibling of `EmbeddingModel` for relevance reordering. Validates indices (in range, unique, count ≤ `topN`), sorts by descending score, short-circuits empty inputs. |
| `ClassifierModel` | `classify`, `fromLanguageModel` | `effect/unstable/ai/ClassifierModel` — single/multi-label text classification with confidences and optional example-shots. |
| `SpeechModel` | `generate`, `stream` | `effect/unstable/ai/SpeechModel` — text-to-speech with both a one-shot buffer surface and a streaming surface, like `LanguageModel.generateText`/`streamText`. |
| `TranscriptionModel` | `transcribe` | `effect/unstable/ai/TranscriptionModel` — speech-to-text with optional segment timestamps and detected language. |
| `ImageModel` | `generate` | `effect/unstable/ai/ImageModel` — prompt-to-image with base64-or-bytes result parts. |
| `ModerationModel` | `moderate`, `fromLanguageModel` | `effect/unstable/ai/ModerationModel` — per-category policy scores plus a flagged verdict. |
| `VoiceConversionModel` | `convert` | `effect/unstable/ai/VoiceConversionModel` — re-voice audio into a target voice. |

`ClassifierModel` and `ModerationModel` additionally expose a
`fromLanguageModel` adapter that backs the abstraction with **any**
`LanguageModel` via structured-output prompting (`LanguageModel.generateObject`),
running the model's output back through the same `make` validation path.

## Example

```ts
import { Effect } from "effect"
import { RerankerModel } from "@thomasfosterau/effect-ai-ext"

// A provider package builds the service via RerankerModel.make(...);
// consumers depend on the tag.
const program = Effect.gen(function* () {
  const reranker = yield* RerankerModel.RerankerModel
  const response = yield* reranker.rerank({
    query: "best editor",
    documents: ["vim", "emacs", "nano"],
    topN: 2,
  })
  return response.results // sorted by descending relevanceScore
})
```

Backing a classifier with a language model:

```ts
import { Effect, Layer } from "effect"
import { LanguageModel } from "effect/unstable/ai"
import { ClassifierModel } from "@thomasfosterau/effect-ai-ext"

declare const SomeLanguageModelLayer: Layer.Layer<LanguageModel.LanguageModel>

const ClassifierLayer = Layer.effect(
  ClassifierModel.ClassifierModel,
  ClassifierModel.fromLanguageModel,
).pipe(Layer.provide(SomeLanguageModelLayer))
```

## `RerankerModel` moved here

`RerankerModel` previously lived in `@thomasfosterau/effect-ai-gateway` — a
reranker abstraction never belonged in a routing package. It now lives here;
the gateway package re-exports it from
`@thomasfosterau/effect-ai-ext/RerankerModel` through a deprecation shim.

## Development

Part of the [`effect-ai-ext` monorepo](../../README.md). See
[AGENTS.md](../../AGENTS.md) for the toolchain.

```sh
pnpm run check   # type-check (native TS7 tsc)
pnpm run test    # vitest (stubbed fixtures, no live network)
pnpm run build   # tsup → one dist file per module entry
```

## License

MIT
