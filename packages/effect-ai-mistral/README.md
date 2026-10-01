# @thomasfosterau/effect-ai-mistral

An [Effect](https://effect.website) AI provider for **Mistral**. Effect ships
no `@effect/ai-mistral` package, so this implements the `LanguageModel`
service directly against Mistral's OpenAI-compatible
`/v1/chat/completions` API.

- **`MistralClient`** — the low-level HTTP client (regular + streaming), every
  failure mapped to `AiError`. Its `apiUrl` override targets a proxy or any
  OpenAI-compatible endpoint.
- **`MistralLanguageModel`** — the `LanguageModel` implementation: prompt /
  tool / structured-output conversion and response decoding, exposed through
  `layer`, `model`, and `make`.

## Install

```sh
pnpm add @thomasfosterau/effect-ai-mistral effect
```

`effect` (`>=4.0.0-rc.118`) is a peer dependency (it must be a singleton).

## Usage

```ts
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";
import { LanguageModel } from "effect/ai";
import { MistralClient, MistralLanguageModel } from "@thomasfosterau/effect-ai-mistral";

const ModelLayer = MistralLanguageModel.layer({ model: "mistral-large-latest" }).pipe(
  Layer.provide(MistralClient.layer({ apiKey: Redacted.make(process.env.MISTRAL_API_KEY!) })),
  Layer.provide(FetchHttpClient.layer),
);

const program = LanguageModel.generateText({ prompt: "Explain Effect in one line" }).pipe(
  Effect.map((response) => response.text),
  Effect.provide(ModelLayer),
);
```

Structured output uses Mistral's native `json_schema` response format;
tool-call parameters are returned as parsed JSON and validated against the
toolkit. Streaming is available via `LanguageModel.streamText`.

## License

MIT
