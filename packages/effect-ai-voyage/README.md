# @thomasfosterau/effect-ai-voyage

A first-party [Effect](https://effect.website) AI provider for **Voyage AI**
(embeddings + rerankers). Effect ships no `@effect/ai-voyage` package, so this
speaks Voyage's own API directly and implements the relevant service
abstractions.

- **`VoyageClient`** — the low-level HTTP client for `/v1/embeddings` and
  `/v1/rerank`, every failure mapped to `AiError`. Its `apiUrl` override
  targets a proxy or a routing layer (the Cloudflare AI Gateway repoints it
  for BYOK).
- **`VoyageEmbeddingModel`** — an `effect/unstable/ai` `EmbeddingModel` over
  `/v1/embeddings`, with `model` + `inputType` + `outputDimension` options and
  the current model/dimension matrix exposed as `EMBEDDING_MODELS`.
- **`VoyageRerankerModel`** — a `@thomasfosterau/effect-ai-ext` `RerankerModel`
  over `/v1/rerank`.

## Install

```sh
pnpm add @thomasfosterau/effect-ai-voyage @thomasfosterau/effect-ai-ext effect
```

`effect` is a peer dependency (it must be a singleton).

## Usage

### Embeddings

```ts
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { EmbeddingModel } from "effect/unstable/ai";
import { VoyageClient, VoyageEmbeddingModel } from "@thomasfosterau/effect-ai-voyage";

const ModelLayer = VoyageEmbeddingModel.layer({
  model: "voyage-3-large",
  inputType: "document",
}).pipe(
  Layer.provide(VoyageClient.layer({ apiKey: Redacted.make(process.env.VOYAGE_API_KEY!) })),
  Layer.provide(FetchHttpClient.layer),
);

const program = Effect.flatMap(EmbeddingModel.EmbeddingModel, (model) =>
  model.embedMany(["hello", "world"]),
).pipe(
  Effect.map((response) => response.embeddings),
  Effect.provide(ModelLayer),
);
```

### Reranking

```ts
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RerankerModel } from "@thomasfosterau/effect-ai-ext";
import { VoyageClient, VoyageRerankerModel } from "@thomasfosterau/effect-ai-voyage";

const RerankerLayer = VoyageRerankerModel.layer({ model: "rerank-2.5" }).pipe(
  Layer.provide(VoyageClient.layer({ apiKey: Redacted.make(process.env.VOYAGE_API_KEY!) })),
  Layer.provide(FetchHttpClient.layer),
);

const program = Effect.flatMap(RerankerModel.RerankerModel, (reranker) =>
  reranker.rerank({
    query: "what is effect?",
    documents: ["a TS library", "a fruit", "a functional-effect system"],
    topN: 2,
  }),
).pipe(Effect.provide(RerankerLayer));
```

## Model / dimension matrix

`VoyageEmbeddingModel.EMBEDDING_MODELS` documents the current Voyage embedding
model ids with their default and selectable dimensions. The Matryoshka models
(`voyage-3-large`, `voyage-3.5`, `voyage-3.5-lite`, `voyage-code-3`) accept
`outputDimension` ∈ {256, 512, 1024, 2048} (default 1024); the domain- and
generation-specific models return a single fixed dimension.

## License

MIT
