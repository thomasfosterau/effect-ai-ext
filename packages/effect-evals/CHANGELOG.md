# @thomasfosterau/effect-evals

## 0.1.1

### Patch Changes

- 315fd6e: Migrate off the removed `Schema.TaggedErrorClass` API (renamed to `Schema.TaggedError` in effect 4.0.0-beta.104) and widen the `effect` peer dependency to `>=4.0.0-beta.104`. The exact `4.0.0-beta.99` pin was already unsatisfiable for consumers on beta.102+.

## 0.1.0

### Minor Changes

- 025e1ec: Initial release.

  An Effect-native LLM evaluation toolkit, expressed as plain Effect values rather than a bolted-on async framework:

  - **Core model** — `Golden` / `EvalCase`, `Score`, `Scorer` (with `contramap`), `Threshold` and `Metric`, and `Dataset`.
  - **Runner** — `runSuite`, with trials, bounded concurrency, retry, and content-hash result caching over `effect`'s own `KeyValueStore`.
  - **Deterministic scorers** — exact match, Levenshtein, JSON validity, schema match, embedding similarity, and tool-call correctness.
  - **Judge metrics** — `GEval` for arbitrary criteria (single- and multi-turn), plus the RAG suite: faithfulness, answer relevancy, and contextual precision / recall / relevancy over a shared extract-then-classify primitive.
  - **Reporters** — terminal and JSON sinks for a completed suite result.
  - **CLI** — an `effect-evals` bin that discovers and runs `*.eval.ts` suites with no test framework involved, running eval files as raw TypeScript through Node's own type stripping.

  Credential gating is built in: a suite whose layer fails to build with a `Config.ConfigError` is reported as skipped rather than failed, so eval files referencing real providers are safe to leave in a credential-less checkout.

  Moved here from `thomasfosterau/website`, where it had been in production use; its pre-move git history is preserved. The `vite-plus/test` adapter it carried there (`./viteplus`) is not part of this release — the core barrel never depended on it, and this repository has no Vite+.
