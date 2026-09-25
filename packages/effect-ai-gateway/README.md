# @thomasfosterau/effect-ai-gateway

Route [Effect](https://effect.website) AI providers through a **Cloudflare AI
Gateway** Worker binding, BYOK (bring-your-own-key). Provider keys are
configured once on the gateway (Cloudflare dashboard) and never live in
application code or env vars — this package never takes or reads an API key.

- **`Anthropic`** — repoints `@effect/ai-anthropic`'s client at the gateway's
  Anthropic route. Drop-in for `AnthropicLanguageModel.layer` +
  `AnthropicClient.layer`.
- **`Cohere`** — `EmbeddingModel` (`embed-v4.0`) and `RerankerModel`
  (`rerank-v3.5`) built directly on the gateway's universal `run()` endpoint.
- **`OpenAiModeration`** — `ModerationModel` (from
  `@thomasfosterau/effect-ai-ext`) backed by OpenAI `omni-moderation-latest`
  through the same universal endpoint. BYOK by default; an application that
  holds its own OpenAI key passes it as `apiKey` (a `Redacted`) and it is sent
  as the bearer token. Text inputs only — the abstraction's contract.
- **`RerankerModel`** — the provider-neutral reranker service abstraction (a
  sibling of `EmbeddingModel`).¹
- **`Binding` / `Url`** — the Worker-binding and public-HTTPS transports.

Every provider comes in a binding-based (`make…`) and a binding-free
(`make…FromUrl`, config-resolved: `CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`,
`CF_AIG_TOKEN`) variant, so callers with no Worker `AI` binding — a local
CLI, a plain Node process, CI, an offline evaluation harness — can route
through the gateway's public HTTPS endpoint too:

| | Worker binding | Public HTTPS endpoint |
| --- | --- | --- |
| Anthropic `LanguageModel` | `anthropicLanguageModelLayer(binding, …)` | `anthropicLanguageModelLayerFromUrl(…)` |
| Cohere `EmbeddingModel` | `makeCohereEmbeddingModel(binding, { inputType })` | `makeCohereEmbeddingModelFromUrl({ inputType })` |
| Cohere `RerankerModel` | `makeCohereReranker(binding)` | `makeCohereRerankerFromUrl` |
| OpenAI `ModerationModel` | `makeOpenAiModerationModel(binding, options?)` | `makeOpenAiModerationModelFromUrl(options?)` |

Both transports share one request body and one lenient response decode per
provider, and every failure — a rejected call, a non-2xx status, an
unreadable or undecodable body — is an `AiError` (`effect/unstable/ai`)
naming the provider module and method.

> ¹ `RerankerModel` migrates to `@thomasfosterau/effect-ai-ext` (issue #2),
> after which this package re-exports it during a deprecation window.

## Install

```sh
pnpm add @thomasfosterau/effect-ai-gateway effect @effect/ai-anthropic
# @cloudflare/workers-types is a peer for the binding-based transports (types only)
```

`effect` and `@effect/ai-anthropic` (both `>=4.0.0-rc.113`) are peer
dependencies (`effect` must be a singleton).

## Usage

```ts
import { Effect } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { anthropicLanguageModelLayer } from "@thomasfosterau/effect-ai-gateway";
import { AI_GATEWAY_ID } from "@thomasfosterau/bindings"; // your gateway id

// Inside a Worker with an `AI` binding:
const layer = anthropicLanguageModelLayer(
  { ai: env.AI, gatewayId: AI_GATEWAY_ID },
  { model: "claude-…" },
);

const program = LanguageModel.generateText({ prompt: "…" }).pipe(Effect.provide(layer));
```

```ts
import * as Effect from "effect/Effect";
import { ModerationModel } from "@thomasfosterau/effect-ai-ext";
import {
  makeCohereRerankerFromUrl,
  makeOpenAiModerationModel,
} from "@thomasfosterau/effect-ai-gateway";

// A plain Node process (an evaluation harness, say): the reranker over the
// gateway's HTTPS endpoint. Config is read once, at construction.
const rerank = Effect.gen(function* () {
  const reranker = yield* makeCohereRerankerFromUrl;
  return yield* reranker.rerank({ query: "monstera", documents, topN: 20 });
});

// Inside a Worker: moderation as a ModerationModel service.
const moderationLayer = Layer.effect(
  ModerationModel.ModerationModel,
  makeOpenAiModerationModel({ ai: env.AI, gatewayId: AI_GATEWAY_ID }),
);
```

## License

MIT
