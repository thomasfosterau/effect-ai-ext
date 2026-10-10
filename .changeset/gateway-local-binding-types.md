---
"@thomasfosterau/effect-ai-gateway": patch
---

The published declarations no longer name `@cloudflare/workers-types`' ambient `Ai`, `AIGatewayProviders` and `AIGatewayUniversalRequest` globals, which a consumer that type-checks with `skipLibCheck: false` and doesn't install that optional peer saw as TS2304 (#113). The gateway now types them itself, with new exports:

- `WorkersAiBinding` (`gateway(id)` → `WorkersAiGateway`, the `getUrl` / `run` slice the gateway calls) is the type of `GatewayBinding.ai`. A Worker's `env.AI`, typed `Ai` by `@cloudflare/workers-types` `4.20250312.0` or later, is assignable to it, so binding callers pass it unchanged.
- `GatewayProvider` (the known provider slugs, autocompleted, or any string) types the `provider` parameter of `gatewayUrl` and `gatewayBaseUrl`.
- `GatewayUniversalRequest` types `gatewayRun`'s request, and `GatewayRunOptions` the options it passes to `run()`.

`@cloudflare/workers-types` stays an optional peer, needed only for your own Worker's typing.
