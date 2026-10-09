---
"@thomasfosterau/effect-ai-mistral": patch
---

Streamed frames and tool-call arguments are parsed with `Schema.fromJsonString(Schema.Json)` instead of a `try`/`catch` around `JSON.parse` (#98). Text that is not JSON is still handed on as the raw string, as before. The one difference is a number literal too large for a finite double (`1e400`), which `JSON.parse` turned into `Infinity`: such text is no longer treated as JSON and is handed on as the raw string.

An SSE frame containing such a literal therefore fails schema decoding, so the stream fails with an `AiError`, as any other malformed frame does.
