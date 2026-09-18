---
"@thomasfosterau/effect-ai-gateway": minor
---

Two new providers, both built on the gateway's universal endpoint:

- **`makeCohereRerankerFromUrl`** — the binding-free sibling of `makeCohereReranker`: a `RerankerModel` backed by Cohere `rerank-v3.5` over the gateway's public HTTPS endpoint (config-resolved `CF_ACCOUNT_ID` / `CF_AIG_GATEWAY_ID` / `CF_AIG_TOKEN`, read once at construction), for a plain Node process, a CLI or CI with no Worker `AI` binding. A plain Effect value (`yield* makeCohereRerankerFromUrl`), since it takes no options.
- **`OpenAiModeration`** — `makeOpenAiModerationModel(binding, options?)` and `makeOpenAiModerationModelFromUrl(options?)`: a `ModerationModel` (`@thomasfosterau/effect-ai-ext`) backed by OpenAI `omni-moderation-latest`. BYOK by default; `options.apiKey` (a `Redacted`) sends the application's own key as the bearer token; `options.model` overrides the model. The response decode is lenient (unknown vendor fields never fail a valid response; `null` "not assessed" scores are dropped rather than graded as zero) and every failure is an `AiError`.

Internally the Cohere and OpenAI modules now share one request/decode pipeline (`internal/transport.ts`) for both the Worker-binding and HTTPS transports, and each Cohere endpoint builds its request body and maps its response once for both transports. No change to the existing Cohere or Anthropic surface.
