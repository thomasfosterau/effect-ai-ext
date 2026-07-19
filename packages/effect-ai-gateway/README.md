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
- **`RerankerModel`** — the provider-neutral reranker service abstraction (a
  sibling of `EmbeddingModel`).¹
- **`Binding` / `Url`** — the Worker-binding and public-HTTPS transports.

Both binding-based (`makeCohere…`) and binding-free (`makeCohere…FromUrl`,
config-resolved) variants exist, so callers with no Worker `AI` binding — a
local CLI, a plain Node process, CI — can route through the gateway's public
HTTPS endpoint too.

> ¹ `RerankerModel` migrates to `@thomasfosterau/effect-ai-ext` (issue #2),
> after which this package re-exports it during a deprecation window.

## Install

```sh
pnpm add @thomasfosterau/effect-ai-gateway effect @effect/ai-anthropic
# @cloudflare/workers-types is a peer for the binding-based transports (types only)
```

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

## License

MIT
