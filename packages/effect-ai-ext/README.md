# @thomasfosterau/effect-ai-ext

Provider-neutral AI service **abstractions** that upstream Effect (`effect/ai`) does not yet ship. `effect/ai` gives you `LanguageModel`, `EmbeddingModel`, `Tokenizer`, `Tool`/`Toolkit`, `Chat`, `Prompt`/`Response`, `Model`, `AiError`, and `Telemetry` — and nothing for reranking, classification, speech, transcription, image generation, moderation, or voice conversion.

This package fills that gap in upstream's own idiom. Every module is written **as if it could merge into `effect/ai` itself** — the same shape as `EmbeddingModel`:

- a `Context.Service` tag (`@thomasfosterau/effect-ai-ext/<Module>`),
- `Schema.Class` response/usage models,
- caller `Options` vs normalised `ProviderOptions`/`ProviderResponse` contracts,
- a `Service` interface whose operations fail only through `AiError`,
- a `make(...)` constructor that **validates** provider results before handing them back, wrapping each operation in `Effect.withSpan`.

No provider code, no HTTP — abstractions only. First-party provider packages (Cohere, Voyage, ElevenLabs, …) implement these services the same way `effect-ai-mistral` implements `LanguageModel`.

## Install

```sh
pnpm add @thomasfosterau/effect-ai-ext effect
```

`effect` (`>=4.0.0-rc.118`) is a peer dependency (it must stay a singleton).

## A superset of `effect/ai`

The package barrel re-exports **every upstream `effect/ai` module** (`LanguageModel`, `EmbeddingModel`, `AiError`, `Tool`/`Toolkit`, `Chat`, `Prompt`/`Response`, `Model`, `Tokenizer`, `Telemetry`, `IdGenerator`, …) alongside the abstractions below, so one import reaches the whole AI service surface — upstream and extension:

```ts
import { LanguageModel, EmbeddingModel, RerankerModel } from "@thomasfosterau/effect-ai-ext";
```

The re-exports are the **same identities** as `effect/ai` (`effect` is the singleton peer), so mixing the two import styles is safe — nothing is wrapped or shadowed. Prefer importing straight from `effect/ai` when you only need upstream modules.

## Modules & their upstream-merge story

Each module is also available as a per-module subpath (mirroring how `effect` itself ships), e.g. `@thomasfosterau/effect-ai-ext/RerankerModel`.

| Module | Operation(s) | If it merged upstream |
| --- | --- | --- |
| `RerankerModel` | `rerank` | Would be `effect/ai/RerankerModel` — the sibling of `EmbeddingModel` for relevance reordering. Validates indices (in range, unique, count ≤ `topN`), sorts by descending score, short-circuits empty inputs. |
| `ClassifierModel` | `classify`, `fromLanguageModel` | Would be `effect/ai/ClassifierModel` — single/multi-label text classification with confidences and optional example-shots. |
| `SpeechModel` | `generate`, `stream` | Would be `effect/ai/SpeechModel` — text-to-speech with both a one-shot buffer surface and a streaming surface, like `LanguageModel.generateText`/`streamText`. |
| `TranscriptionModel` | `transcribe` | Would be `effect/ai/TranscriptionModel` — speech-to-text with optional segment timestamps and detected language. |
| `ImageModel` | `generate` | Would be `effect/ai/ImageModel` — prompt-to-image with base64-or-bytes result parts. |
| `ModerationModel` | `moderate`, `fromLanguageModel` | Would be `effect/ai/ModerationModel` — per-category policy scores plus an `isFlagged` verdict. |
| `VoiceConversionModel` | `convert` | Would be `effect/ai/VoiceConversionModel` — re-voice audio into a target voice. |

`ClassifierModel` and `ModerationModel` additionally expose a `fromLanguageModel` adapter that backs the abstraction with **any** `LanguageModel` via structured-output prompting (`LanguageModel.generateObject`), running the model's output back through the same `make` validation path.

## Example

```ts
import { Effect } from "effect";
import { RerankerModel } from "@thomasfosterau/effect-ai-ext";

// A provider package builds the service via RerankerModel.make(...);
// consumers depend on the tag.
const program = Effect.gen(function* () {
  const reranker = yield* RerankerModel.RerankerModel;
  const response = yield* reranker.rerank({
    query: "best editor",
    documents: ["vim", "emacs", "nano"],
    topN: 2,
  });
  return response.results; // sorted by descending relevanceScore
});
```

Backing a classifier with a language model:

```ts
import { Effect, Layer } from "effect";
import { LanguageModel } from "effect/ai";
import { ClassifierModel } from "@thomasfosterau/effect-ai-ext";

declare const SomeLanguageModelLayer: Layer.Layer<LanguageModel.LanguageModel>;

const ClassifierLayer = Layer.effect(
  ClassifierModel.ClassifierModel,
  ClassifierModel.fromLanguageModel,
).pipe(Layer.provide(SomeLanguageModelLayer));
```

## `RerankerModel` moved here

`RerankerModel` previously lived in `@thomasfosterau/effect-ai-gateway` — a reranker abstraction never belonged in a routing package. It now lives here: import it from `@thomasfosterau/effect-ai-ext/RerankerModel`. The gateway kept a deprecated re-export through 0.4.x and removed it in 0.5.0, so `@thomasfosterau/effect-ai-gateway` no longer exports any `RerankerModel` name; its Cohere reranker (`makeCohereReranker`) returns this module's `Service`.

## License

MIT
