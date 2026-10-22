# @thomasfosterau/effect-ai-mistral

An [Effect](https://effect.website) AI provider for **Mistral**. Effect ships no `@effect/ai-mistral` package, so this implements the `LanguageModel` service from `effect/ai` directly against Mistral's OpenAI-compatible `/v1/chat/completions` API. Nothing downstream of `LanguageModel.LanguageModel` needs to know the provider is Mistral.

## Install

```sh
pnpm add @thomasfosterau/effect-ai-mistral effect
```

`effect` (`>=4.0.0-rc.118`) is a peer dependency: it must be a single copy across your app.

## Usage

```ts
import { Config, Effect, Layer } from "effect";
import { LanguageModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { MistralClient, MistralLanguageModel } from "@thomasfosterau/effect-ai-mistral";

const MistralLive = MistralLanguageModel.layer({ model: "mistral-large-latest" }).pipe(
  Layer.provide(MistralClient.layerConfig({ apiKey: Config.Redacted("MISTRAL_API_KEY") })),
  Layer.provide(FetchHttpClient.layer),
);

const program = LanguageModel.generateText({ prompt: "Explain Effect in one line" }).pipe(
  Effect.map((response) => response.text),
  Effect.provide(MistralLive),
);
```

`LanguageModel.streamText`, `generateObject` and tool calling work through the same layer.

## API

### `MistralClient`

The low-level HTTP client over an `HttpClient` from context (provide `FetchHttpClient.layer` or any other).

| Export | What it is |
| --- | --- |
| `MistralClient` | The `Context.Service` tag. Its `Service` has `createChatCompletion` and `createChatCompletionStream` (SSE, ending at Mistral's `[DONE]` sentinel). |
| `make(options)` | Builds the service effectfully. |
| `layer(options)` | The service as a `Layer`, requiring `HttpClient`. |
| `layerConfig(options?)` | The same, each option read from a `Config` (`apiKey: Config<Redacted \| undefined>`, `apiUrl: Config<string>`); fails with `ConfigError`. |
| `defaultApiUrl` | `"https://api.mistral.ai"`. |

`Options`:

- `apiKey?: Redacted<string>` — sent as a bearer token. Omit it when a proxy injects the credential (or in tests): requests then carry no `authorization` header.
- `apiUrl?: string` — the base URL. Override it to point the client at a proxy, a gateway route (BYOK) or another OpenAI-compatible endpoint.
- `transformClient?: (client: HttpClient) => HttpClient` — middleware over the underlying client (logging, retries, …).

### `MistralLanguageModel`

| Export | What it is |
| --- | --- |
| `layer({ model, config? })` | A `LanguageModel.LanguageModel` layer requiring `MistralClient`. |
| `model(model, config?)` | An `AiModel.Model<"mistral", LanguageModel, MistralClient>` descriptor, providable with `Effect.provide`. |
| `make({ model, config? })` | The `LanguageModel` service effect. |
| `Config` / `ConfigService` | A context service of request defaults: `model`, `temperature`, `topP`, `maxTokens`, `randomSeed`, `stop`, `presencePenalty`, `frequencyPenalty`. Values in context override the construction-time `config`. |
| `withConfigOverride(overrides)` | Applies `ConfigService` overrides to one effect (data-first or data-last). |
| `Model` | Well-known model ids, for autocomplete only: any string is accepted. |

```ts
import { Effect } from "effect";
import { LanguageModel } from "effect/ai";
import { MistralLanguageModel } from "@thomasfosterau/effect-ai-mistral";

const precise = LanguageModel.generateText({ prompt: "2 + 2 =" }).pipe(
  MistralLanguageModel.withConfigOverride({ temperature: 0, maxTokens: 8 }),
);
```

## Behaviour

- **Structured output** uses Mistral's native `json_schema` response format (`strict: true`); the framework parses the returned content against your schema.
- **Tools**: tool-call parameters come back as parsed JSON and are validated against the toolkit by `effect/ai`.
- **Files**: user messages accept image file parts (sent as `image_url`); any other media type fails with an `AiError`, since Mistral chat completions accept images only.
- **Errors**: every transport, HTTP-status and decoding failure leaves the provider as an `AiError` from `effect/ai`, its reason derived from the HTTP status.
- **Lenient decoding**: unknown or missing response fields never fail an otherwise-valid response.

## License

MIT
