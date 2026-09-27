# @thomasfosterau/effect-ai-cohere

A first-party [Effect](https://effect.website) AI provider for **Cohere**.
Effect ships no `@effect/ai-cohere` package, so this implements each capability
directly against Cohere's v2 API.

- **`CohereClient`** — the low-level HTTP client for `/v2/chat` (regular +
  streaming), `/v2/embed`, and `/v2/rerank`, every failure mapped to `AiError`.
  Its `apiUrl` override is the BYOK routing contract used by the Cloudflare AI
  Gateway package.
- **`CohereLanguageModel`** — the `LanguageModel` implementation over Command
  chat models: prompt / tool / structured-output conversion and response
  decoding, exposed through `layer`, `model`, and `make`.
- **`CohereEmbeddingModel`** — the `EmbeddingModel` implementation over
  `embed-v4.0` (pinned model + 1024-dim output; retrieval-aware `inputType`).
- **`CohereRerankerModel`** — the effect-ai-ext `RerankerModel` implementation
  over `rerank-v3.5`.
- **`CohereClassifierModel`** — the effect-ai-ext `ClassifierModel`
  implementation, backed by Cohere chat + structured output.

## Install

```sh
pnpm add @thomasfosterau/effect-ai-cohere effect
```

`effect` (`>=4.0.0-rc.113`) is a peer dependency (it must be a singleton).

## Usage

```ts
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { LanguageModel } from "effect/unstable/ai";
import { CohereClient, CohereLanguageModel } from "@thomasfosterau/effect-ai-cohere";

const ModelLayer = CohereLanguageModel.layer({ model: "command-a-03-2025" }).pipe(
  Layer.provide(CohereClient.layer({ apiKey: Redacted.make(process.env.COHERE_API_KEY!) })),
  Layer.provide(FetchHttpClient.layer),
);

const program = LanguageModel.generateText({ prompt: "Explain Effect in one line" }).pipe(
  Effect.map((response) => response.text),
  Effect.provide(ModelLayer),
);
```

`CohereClient.layer` accepts an `apiUrl` override — the same client can be
repointed at the Cloudflare AI Gateway route for BYOK. Structured output uses
Cohere's native `response_format` JSON-schema mode; tool-call parameters are
returned as parsed JSON and validated against the toolkit. Streaming is
available via `LanguageModel.streamText`.

### Embeddings, reranking, classification

```ts
import { CohereClient, CohereEmbeddingModel, CohereRerankerModel } from "@thomasfosterau/effect-ai-cohere";
import { EmbeddingModel } from "effect/unstable/ai";
import { RerankerModel } from "@thomasfosterau/effect-ai-ext";

const EmbedLayer = CohereEmbeddingModel.layer({ inputType: "search_document" }).pipe(
  Layer.provide(CohereClient.layer({ apiKey: Redacted.make(process.env.COHERE_API_KEY!) })),
  Layer.provide(FetchHttpClient.layer),
);
```

## A note on classification

Cohere's dedicated Classify surface is v1-legacy: there is no `v2/classify`,
and `/v1/classify` now requires a fine-tuned Embed model (default-model
classification was deprecated 2025-01-31). `CohereClassifierModel` therefore
backs the `ClassifierModel` abstraction with Cohere **chat + structured
output** over a Command model — covering the full `ClassifyOptions` contract
(caller label sets, open-set, multi-label, example-shot) on a supported v2
surface. See `CohereClassifierModel`'s module docs for the full rationale.

## License

MIT
