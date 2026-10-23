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

## Modules

Each module is also available as a per-module subpath (mirroring how `effect` itself ships), e.g. `@thomasfosterau/effect-ai-ext/RerankerModel`. Every module exports the same set of names: the service tag (`RerankerModel.RerankerModel`, …), its `Service` interface, the caller options, the normalised `ProviderOptions` / `ProviderResponse` a provider implements, the `Schema.Class` response and usage models, and `make`.

| Module | Operation(s) | Caller options | Response | `make` validates |
| --- | --- | --- | --- | --- |
| `RerankerModel` | `rerank` | `RerankOptions`: `query`, `documents`, `topN?` | `RerankResponse`: `results` (`RerankedDocument`: `index`, `relevanceScore`), sorted by descending score; `usage.inputTokens` | every `index` names an input document, indices are unique, count ≤ `topN` (or the document count); no documents → empty response, provider not called |
| `ClassifierModel` | `classify` | `ClassifyOptions`: `inputs`, `labels?`, `multiLabel?`, `examples?` (`ClassifyExample`: `text`, `label`) | `ClassifyResponse`: one `Classification` (`classes`: `ClassScore` `label` / `score`) per input; `usage.inputTokens` | one classification per input, finite scores, labels within `labels` when given; no inputs → empty response |
| `SpeechModel` | `generate`, `stream` | `SpeechOptions`: `text`, `voice?`, `format?`, `sampleRate?` | `SpeechResponse`: `audio` (`Uint8Array`), `mediaType`, `usage.inputCharacters`; `stream` yields `Uint8Array` chunks | non-empty audio (`generate`); `stream` passes through, traced |
| `TranscriptionModel` | `transcribe` | `TranscriptionOptions`: `audio` (`Uint8Array` or `Stream<Uint8Array>`), `mediaType?`, `language?` | `TranscriptionResponse`: `text`, `segments?` (`TranscriptionSegment`: `text`, `start`, `end`), `language?`, `usage.durationSeconds` | segment timestamps finite with `end >= start` |
| `ImageModel` | `generate` | `ImageOptions`: `prompt`, `size?`, `format?`, `count?` | `ImageResponse`: `images` (`ImagePart`: `data` as bytes or base64 string, `mediaType`), `usage.inputTokens` | at least one image, at most `count` |
| `ModerationModel` | `moderate` | `ModerationOptions`: `inputs` (each a string, or an array of `effect/ai` `Prompt.UserMessagePartEncoded` text / file parts screened as one input) | `ModerationResponse`: one `ModerationResult` (`isFlagged`, `categories`: category → score, `flags?`: the provider's category → fired) per input; `modelId?` (the model that served the call); `usage.inputTokens` | one result per input, scores finite in `[0, 1]`; no inputs → empty response; an empty part list → `InvalidUserInputError` |
| `VoiceConversionModel` | `convert` | `VoiceConversionOptions`: `audio` (`Uint8Array` or `Stream<Uint8Array>`), `targetVoice`, `format?` | `VoiceConversionResponse`: `audio`, `mediaType`, `usage.durationSeconds` | non-empty audio |

A result that fails validation fails the call with an `AiError` whose reason is `InvalidOutputError`. Every operation is wrapped in `Effect.withSpan("<Module>.<operation>")`.

`ClassifierModel` and `ModerationModel` additionally export `fromLanguageModel`, an `Effect<Service, never, LanguageModel>` that backs the abstraction with **any** `LanguageModel` via structured-output prompting (`LanguageModel.generateObject`), running the model's output back through the same `make` validation path.

Were they to merge upstream, each module would become `effect/ai/<Module>`, the sibling of `EmbeddingModel`.

## Example

```ts
import { Effect } from "effect";
import { RerankerModel } from "@thomasfosterau/effect-ai-ext";

// Consumers depend on the tag; a provider layer supplies it.
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

Implementing the service in a provider: `make` takes the provider hook and returns the validated service.

```ts
import { Effect, Layer } from "effect";
import * as RerankerModel from "@thomasfosterau/effect-ai-ext/RerankerModel";

const KeywordReranker = Layer.effect(
  RerankerModel.RerankerModel,
  RerankerModel.make({
    rerank: ({ query, documents }) =>
      Effect.succeed({
        results: documents.map((document, index) => ({
          index,
          relevanceScore: document.includes(query) ? 1 : 0,
        })),
        usage: { inputTokens: undefined },
      }),
  }),
);
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
