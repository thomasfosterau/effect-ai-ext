# @thomasfosterau/effect-ai-gateway

The routing layer: repoints other providers' clients at a Cloudflare AI Gateway route, through a Worker `AI` binding or the gateway's public HTTPS endpoint, BYOK. It is not itself a provider: Anthropic goes through the upstream `@effect/ai-anthropic` client; Cohere embed / rerank and OpenAI moderation go through the gateway's universal endpoint.

## Boundary

Peers: `effect`, `@effect/ai-anthropic`, and `@cloudflare/workers-types` (optional, types only). May import `@thomasfosterau/effect-ai-ext` and nothing else from this workspace (`.fallowrc.json` zone `gateway`). The barrel is flat (`export *` of each module) and re-exports no `RerankerModel` name; consumers import it from `@thomasfosterau/effect-ai-ext/RerankerModel` (#97).

## Invariants

- **The published `.d.ts` names nothing from `@cloudflare/workers-types`** (#113): the binding is typed by the structural `WorkersAiBinding` / `WorkersAiGateway`, which a real `env.AI: Ai` must stay assignable to (`tests/workers-types-binding.test.ts`; `vp run check:dist` compiles a Worker probe against the built types). The workers-types peer floor is the first release whose `AiGateway` declares `getUrl()`.
- **No provider key is read.** Keys live on the gateway; upstream clients get `apiKey: undefined`. The only key taken is `OpenAiModeration`'s optional, caller-supplied `apiKey`.
- **Every provider has a binding variant and a `…FromUrl` variant** sharing one request body and one lenient response decode. The URL variants read `CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID` and `CF_AIG_TOKEN` (`Url.gatewayUrlConfig`), all required, no default gateway id: a missing or empty one fails construction with a `ConfigError`.
- **Every failure is an `AiError`** naming the module and method: a rejected binding call, a non-2xx status, an unreadable or undecodable body.
- **Interrupting a `gatewayRun` aborts the subrequest** (the `signal` from `Effect.tryPromise` is passed to `run`; `tests/binding.test.ts`). The HTTPS variants ride `FetchHttpClient`, which is already interruption-safe.
- **No application vocabulary**: the gateway id is always the caller's.
