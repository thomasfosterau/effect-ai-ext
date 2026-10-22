# @thomasfosterau/effect-ai-mistral

A first-party provider over Mistral's OpenAI-compatible `/v1/chat/completions`: `MistralClient` (HTTP + SSE) and `MistralLanguageModel` (an `effect/ai` `LanguageModel`). It is the reference first-party provider the others mirror.

## Boundary

Peer: `effect` only. Imports nothing from this workspace (`.fallowrc.json` zone `mistral`, no outbound rule): it implements only upstream `effect/ai` services.

## Invariants

- **`apiUrl` is a contract**: it is how a routing layer repoints the client for BYOK, so it prefixes every request path and an omitted `apiKey` sends no `authorization` header. `tests/mistral.test.ts` points `apiUrl` at a stub.
- **Errors leave the package only as `AiError`.** `internal/errors.ts` maps `HttpClientError`, `SchemaError` and SSE framing failures through `AiError.reasonFromHttpStatus`; a non-image file part fails as invalid user input.
- **Wire discipline** (`internal/wire.ts`): requests are hand-written interfaces sent as JSON; responses decode leniently (`Schema.optional` + `Schema.NullOr`, free strings for enums the mapper narrows), so a new Mistral field never fails an otherwise-valid response.
- **The surface mirrors `@effect/ai-anthropic`'s `AnthropicLanguageModel`**: `model`, `layer`, `make`, `Config`, `withConfigOverride`; `Config` in context wins over construction-time `config`.
- **Structured output uses `json_schema` with `strict: true`**; tool parameters are returned as parsed JSON for `effect/ai` to validate.
