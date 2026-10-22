# @thomasfosterau/effect-ai-cohere

A first-party [Effect](https://effect.website) AI provider for **Cohere**. Effect ships no `@effect/ai-cohere` package, so this implements each capability directly against Cohere's v2 API: `LanguageModel` and `EmbeddingModel` from `effect/ai`, and `RerankerModel` and `ClassifierModel` from [`@thomasfosterau/effect-ai-ext`](https://github.com/thomasfosterau/effect-ai-ext/tree/trunk/packages/effect-ai-ext).

## Install

```sh
pnpm add @thomasfosterau/effect-ai-cohere effect
```

`effect` (`>=4.0.0-rc.118`) is a peer dependency: it must be a single copy across your app. `@thomasfosterau/effect-ai-ext` is a dependency; add it yourself to import the `RerankerModel` / `ClassifierModel` tags.

## Usage

```ts
import { Config, Effect, Layer } from "effect";
import { LanguageModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { CohereClient, CohereLanguageModel } from "@thomasfosterau/effect-ai-cohere";

const CohereClientLive = CohereClient.layerConfig({
  apiKey: Config.Redacted("COHERE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

const CohereLive = CohereLanguageModel.layer({ model: "command-a-03-2025" }).pipe(
  Layer.provide(CohereClientLive),
);

const program = LanguageModel.generateText({ prompt: "Explain Effect in one line" }).pipe(
  Effect.map((response) => response.text),
  Effect.provide(CohereLive),
);
```

### Embeddings, reranking, classification

```ts
import { Config, Effect, Layer } from "effect";
import { EmbeddingModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { RerankerModel } from "@thomasfosterau/effect-ai-ext";
import {
  CohereClassifierModel,
  CohereClient,
  CohereEmbeddingModel,
  CohereRerankerModel,
} from "@thomasfosterau/effect-ai-cohere";

const CohereClientLive = CohereClient.layerConfig({
  apiKey: Config.Redacted("COHERE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

const CohereLive = Layer.mergeAll(
  CohereEmbeddingModel.layer({ inputType: "search_document" }),
  CohereRerankerModel.layer(),
  CohereClassifierModel.layer(),
).pipe(Layer.provide(CohereClientLive));

const program = Effect.gen(function* () {
  const embedder = yield* EmbeddingModel.EmbeddingModel;
  const reranker = yield* RerankerModel.RerankerModel;
  const { embeddings } = yield* embedder.embedMany(["hello", "world"]);
  const { results } = yield* reranker.rerank({
    query: "greeting",
    documents: ["hello", "tax law"],
  });
  return { embeddings, results };
}).pipe(Effect.provide(CohereLive));
```

## API

### `CohereClient`

The low-level HTTP client over an `HttpClient` from context. Its `Service` has `chat` and `chatStream` (`/v2/chat`, SSE), `embed` (`/v2/embed`) and `rerank` (`/v2/rerank`).

| Export | What it is |
| --- | --- |
| `CohereClient` | The `Context.Service` tag. |
| `make(options)` / `layer(options)` | The service, effectfully or as a `Layer` requiring `HttpClient`. |
| `layerConfig(options?)` | The same, each option read from a `Config` (`apiKey: Config<Redacted \| undefined>`, `apiUrl: Config<string>`); fails with `ConfigError`. |
| `defaultApiUrl` | `"https://api.cohere.com"`. |

`Options`: `apiKey?: Redacted<string>` (sent as a bearer token; omit it when a proxy injects the credential), `apiUrl?: string` (override it to point the client at a proxy or a gateway route for BYOK), `transformClient?: (client: HttpClient) => HttpClient`.

### `CohereLanguageModel`

The `LanguageModel` over Command chat models.

| Export | What it is |
| --- | --- |
| `layer({ model, config? })` / `make({ model, config? })` | The service as a layer requiring `CohereClient`, or as an effect. |
| `model(model, config?)` | An `AiModel.Model<"cohere", LanguageModel, CohereClient>` descriptor. |
| `Config` / `ConfigService` | Request defaults in context: `model`, `temperature`, `topP` (Cohere's `p`), `topK` (`k`), `maxTokens`, `seed`, `stopSequences`, `presencePenalty`, `frequencyPenalty`. Context values override the construction-time `config`. |
| `withConfigOverride(overrides)` | Applies overrides to one effect (data-first or data-last). |
| `Model` | Well-known model ids, for autocomplete only. |

Structured output uses Cohere's native `response_format` JSON-schema mode; tool-call parameters are returned as parsed JSON and validated against the toolkit. Cohere's `tool_choice` (`REQUIRED` / `NONE`, sent for `toolChoice: "required"`, a named tool, or `"none"` with a toolkit) is only accepted by Command R7B and newer; on older models (`command-r`, `command-r-plus` and their dated releases) use `"auto"`. User messages accept image file parts; any other media type fails with an `AiError`.

### `CohereEmbeddingModel`

An `EmbeddingModel` over `/v2/embed`. `layer(options)` / `make(options)` take `inputType` (`InputType`: `"search_document"`, `"search_query"`, `"classification"`, `"clustering"`, `"image"`), `model?` (default `EMBEDDING_MODEL`, `"embed-v4.0"`) and `outputDimension?` (default `EMBEDDING_DIMENSIONS`, `1024`, sent on every request).

### `CohereRerankerModel`

A `RerankerModel` over `/v2/rerank`. `layer(options?)` / `make(options?)` take `model?` (default `RERANK_MODEL`, `"rerank-v3.5"`). Cohere bills reranking in search units; they are reported as `usage.inputTokens`.

### `CohereClassifierModel`

A `ClassifierModel` backed by Cohere chat with structured output (`ClassifierModel.fromLanguageModel` over `CohereLanguageModel`). `layer(options?)` / `make(options?)` take `model?` (default `DEFAULT_MODEL`, `"command-a-03-2025"`) and `config?` (chat tuning; temperature defaults to `0` for deterministic labelling).

Cohere's dedicated Classify surface is v1-legacy: there is no `v2/classify`, and `/v1/classify` now requires a fine-tuned Embed model (default-model classification was deprecated 2025-01-31). Chat with structured output covers the full `ClassifyOptions` contract (caller label sets, open-set, multi-label, example shots) on a supported v2 surface.

### Errors

Every transport, HTTP-status and decoding failure leaves the provider as an `AiError` from `effect/ai`, its reason derived from the HTTP status. Unknown or missing response fields never fail an otherwise-valid response.

## License

MIT
