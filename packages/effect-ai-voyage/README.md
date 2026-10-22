# @thomasfosterau/effect-ai-voyage

A first-party [Effect](https://effect.website) AI provider for **Voyage AI** (embeddings + rerankers). Effect ships no `@effect/ai-voyage` package, so this speaks Voyage's own API directly and implements the relevant service abstractions.

- **`VoyageClient`** — the low-level HTTP client for `/v1/embeddings` and `/v1/rerank`, every failure mapped to `AiError`. Its `apiUrl` override targets a proxy or a routing layer (the Cloudflare AI Gateway repoints it for BYOK).
- **`VoyageEmbeddingModel`** — an `effect/ai` `EmbeddingModel` over `/v1/embeddings`, with `model` + `inputType` + `outputDimension` options and the current model/dimension matrix exposed as `EMBEDDING_MODELS`.
- **`VoyageRerankerModel`** — a `@thomasfosterau/effect-ai-ext` `RerankerModel` over `/v1/rerank`.

## Install

```sh
pnpm add @thomasfosterau/effect-ai-voyage @thomasfosterau/effect-ai-ext effect
```

`effect` (`>=4.0.0-rc.118`) is a peer dependency: it must be a single copy across your app. `@thomasfosterau/effect-ai-ext` is a dependency; add it yourself to import the `RerankerModel` tag.

## Usage

### Embeddings

```ts
import { Config, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { EmbeddingModel } from "effect/ai";
import { VoyageClient, VoyageEmbeddingModel } from "@thomasfosterau/effect-ai-voyage";

const ModelLayer = VoyageEmbeddingModel.layer({
  model: "voyage-3-large",
  inputType: "document",
}).pipe(
  Layer.provide(VoyageClient.layerConfig({ apiKey: Config.Redacted("VOYAGE_API_KEY") })),
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
import { Config, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RerankerModel } from "@thomasfosterau/effect-ai-ext";
import { VoyageClient, VoyageRerankerModel } from "@thomasfosterau/effect-ai-voyage";

const RerankerLayer = VoyageRerankerModel.layer({ model: "rerank-2.5" }).pipe(
  Layer.provide(VoyageClient.layerConfig({ apiKey: Config.Redacted("VOYAGE_API_KEY") })),
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

## API

### `VoyageClient`

The low-level HTTP client over an `HttpClient` from context (provide `FetchHttpClient.layer` or any other). Its `Service` has `createEmbeddings` (`/v1/embeddings`) and `createRerank` (`/v1/rerank`).

| Export | What it is |
| --- | --- |
| `VoyageClient` | The `Context.Service` tag. |
| `make(options)` / `layer(options)` | The service, effectfully or as a `Layer` requiring `HttpClient`. |
| `layerConfig(options?)` | The same, each option read from a `Config` (`apiKey: Config<Redacted \| undefined>`, `apiUrl: Config<string>`); fails with `ConfigError`. |
| `defaultApiUrl` | `"https://api.voyageai.com"`. |

`Options`: `apiKey?: Redacted<string>` (sent as a bearer token; omit it when a proxy injects the credential), `apiUrl?: string` (override it to point the client at a proxy or a gateway route for BYOK), `transformClient?: (client: HttpClient) => HttpClient`.

### `VoyageEmbeddingModel`

An `effect/ai` `EmbeddingModel`. `layer(options)`, `make(options)` and `model(options)` (an `AiModel.Model<"voyage", EmbeddingModel, VoyageClient>` descriptor) take `Options`:

- `model` — the model id; any string is accepted (`Model` lists the known ids for autocomplete).
- `inputType?: "query" | "document" | null` — embed stored documents with `"document"` and search queries with `"query"`; omit to embed as-is.
- `outputDimension?: number` — the Matryoshka output dimension (see below); omit for the model's default.
- `truncation?: boolean` — whether Voyage truncates over-length inputs instead of failing (Voyage defaults to `true`).

Results are returned in input order whatever order Voyage reports them in. `EMBEDDING_MODELS` and `defaultDimension(model)` describe the known models.

### `VoyageRerankerModel`

A `RerankerModel` from `@thomasfosterau/effect-ai-ext`. `layer(options)` and `make(options)` take `{ model, truncation? }`; `topN` is sent as Voyage's `top_k`. `RERANKER_MODELS` lists the current reranker ids. Validation, sorting and the empty-documents short-circuit come from `RerankerModel.make`.

### Errors

Every transport, HTTP-status and decoding failure leaves the provider as an `AiError` from `effect/ai`, its reason derived from the HTTP status. Unknown or missing response fields never fail an otherwise-valid response.

## Model / dimension matrix

`VoyageEmbeddingModel.EMBEDDING_MODELS` documents the current Voyage embedding model ids with their default and selectable dimensions. The Matryoshka models (`voyage-3-large`, `voyage-3.5`, `voyage-3.5-lite`, `voyage-code-3`) accept `outputDimension` ∈ {256, 512, 1024, 2048} (default 1024); the domain- and generation-specific models return a single fixed dimension. A model id missing from the matrix still works: Voyage applies its own default dimension.

## License

MIT
