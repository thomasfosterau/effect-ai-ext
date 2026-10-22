# @thomasfosterau/effect-ai-cohere

A first-party provider over Cohere's v2 API: `CohereClient` (`/v2/chat` with SSE, `/v2/embed`, `/v2/rerank`), `CohereLanguageModel` and `CohereEmbeddingModel` (`effect/ai` services), and `CohereRerankerModel` and `CohereClassifierModel` (`effect-ai-ext` services). Shaped like `effect-ai-mistral`.

## Boundary

Peer: `effect`. May import `@thomasfosterau/effect-ai-ext` (a `workspace:*` dependency) and nothing else from this workspace (`.fallowrc.json` zone `cohere`).

## Invariants

- **`apiUrl` is a contract**: it is how a routing layer repoints the client for BYOK; an omitted `apiKey` sends no `authorization` header. `tests/cohere.test.ts` points `apiUrl` at a stub.
- **Errors leave the package only as `AiError`**, mapped in `internal/errors.ts` through `AiError.reasonFromHttpStatus`.
- **Lenient decoding** (`internal/wire.ts`): `Schema.optional` + `Schema.NullOr`, free strings for enums, so a new Cohere field never fails a valid response.
- **Classification is chat + structured output**, never `/v1/classify` (v1-legacy, fine-tuned models only): `CohereClassifierModel` is `ClassifierModel.fromLanguageModel` over `CohereLanguageModel`, temperature `0` by default.
- **Pinned defaults are single constants** so rotation is one edit: `EMBEDDING_MODEL` (`embed-v4.0`) with `EMBEDDING_DIMENSIONS` (1024, sent on every request), `RERANK_MODEL` (`rerank-v3.5`), the classifier's `DEFAULT_MODEL`.
- **`tool_choice` is sent only for `"required"`, a named tool, or `"none"` with a toolkit**: older Command models reject it, so `"auto"` sends none.
