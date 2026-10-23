---
"@thomasfosterau/effect-evals": minor
---

`runRetrievalSuite` carries per-case context to the port and keeps each case's ranked page and latency (#142).

- **The port receives the golden.** `RetrievalPort.retrieve(query, { limit, golden })`: the case's golden arrives beside its query, so per-case narrowing (a type filter, a locale) needs no lookup keyed on the query string. `RetrievalSuite`, `RetrievalPort`, `RetrievalSuiteResult` and `runRetrievalSuite` take a `Golden extends RetrievalGolden` parameter (default `RetrievalGolden`) for a richer golden. Existing ports that read only `limit` keep compiling; code that calls a port's `retrieve` directly must now pass `golden`.
- **Task outputs are kept.** `Result.CaseResult` gains `taskOutputs: ReadonlyArray<Result.TaskTrialOutput<Output>>` — per successful trial, the task's `output`, its `durationMillis` (retries included) and whether it was `cached` (a cached trial has a duration of `0`). `CaseResult` and `SuiteResult` take an `Output` type parameter (default `unknown`), and `runSuite` returns `SuiteResult<Golden, Output>`. For a retrieval suite the output is the ranked page, truncated to `k`. The `json` reporter writes the new field. Code that constructs a `CaseResult` by hand must add `taskOutputs`.
