# @thomasfosterau/effect-ai-voyage

A first-party provider over Voyage AI: `VoyageClient` (`/v1/embeddings`, `/v1/rerank`), `VoyageEmbeddingModel` (an `effect/ai` `EmbeddingModel`) and `VoyageRerankerModel` (an `effect-ai-ext` `RerankerModel`). Shaped like `effect-ai-mistral`.

## Boundary

Peer: `effect`. May import `@thomasfosterau/effect-ai-ext` (a `workspace:*` dependency) and nothing else from this workspace (`.fallowrc.json` zone `voyage`).

## Invariants

- **`apiUrl` is a contract**: it is how a routing layer repoints the client for BYOK; an omitted `apiKey` sends no `authorization` header. `tests/voyage.test.ts` points `apiUrl` at a stub.
- **Errors leave the package only as `AiError`**, mapped in `internal/errors.ts` through `AiError.reasonFromHttpStatus`.
- **Lenient decoding** (`internal/wire.ts`), so a new Voyage field never fails a valid response.
- **Optional request fields are omitted, not sent as `undefined` / `null`**: `input_type`, `output_dimension`, `truncation` and `top_k` appear only when the caller set them, so Voyage applies its own defaults.
- **Embeddings come back in input order**, sorted by Voyage's reported `index` (arrival order when absent); `EmbeddingModel.make` checks one result per input.
- **`EMBEDDING_MODELS` is documentation, not a gate**: any model id is accepted, and an unknown id's dimension is Voyage's default.
