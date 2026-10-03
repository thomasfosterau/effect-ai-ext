# @thomasfosterau/effect-evals

## 0.3.2

### Patch Changes

- f900012: Tested against effect 4.0.0 (with @effect/ai-anthropic and @effect/platform-node 4.0.0); peer floor unchanged.

## 0.3.1

### Patch Changes

- 15080ed: Documentation only. Doc comments now open with their summary (module headers no longer start with `@module` or `@copyright`, so editor hovers show it), the misleading `@since 4.0.0` tags are gone (no 4.0.0 of these packages exists), and comments that cite another repository's issues and decision records say so (`website#NNN`). The `effect-ai-gateway` README examples compile and its barrel has a summary; the `effect-evals` README gains an Install section and the modules its table omitted.
- f625a1a: Fix the `effect-evals` bin failing to start from `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). The CLI entry is now built to `dist/cli/main.js` and the bin launches that; Node's type stripping and the loader hook apply only to your own `*.eval.ts` files. The CLI still needs the optional peer `@effect/platform-node` installed at the same version as `effect`.

## 0.3.0

### Minor Changes

- 3a3db62: **Breaking:** require `effect@>=4.0.0-rc.118` (and `@effect/ai-anthropic` / `@effect/platform-node` `>=4.0.0-rc.118` where peered). Effect rc.118 moved every `effect/unstable/*` module to `effect/*` (for example `effect/unstable/ai/LanguageModel` is now `effect/ai/LanguageModel`), so published builds now import the new paths and no longer resolve against earlier rcs. Upgrade `effect` and its `@effect/*` companions together. Cohere and Mistral encode image data URIs with `effect/encoding/Base64` (the `effect/Encoding` module was split in rc.118).

## 0.2.0

### Minor Changes

- 1091f13: **Breaking:** the `effect` peer dependency moves from `>=4.0.0-beta.104` to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.
  
  - **Breaking: `@effect/platform-node` is now an optional peer dependency (`>=4.0.0-rc.113`) instead of a dependency.** It was published as an exact pin, whose own `effect` peer — and the `@effect/platform-node-shared` it floats to the newest rc — rejected any `effect` older than that pin, so npm reported ERESOLVE / ELSPROBLEMS for consumers on an older rc. Only the `effect-evals` CLI needs it: install `@effect/platform-node` at your `effect` version (and pin `@effect/platform-node-shared` to it too). The library entry needs nothing extra.
  - The CLI's flags use the rc constructors (`Flag.String` / `Int` / `Boolean` / `Literals`, `Argument.String`). rc.113 removed the lower-case spellings. The `effect-evals` command line is unchanged.
- 4d53f7f: Retrieval-ranking evaluation, ported from gardeneria's `packages/evaluation` harness (its hand-computed tests are the fixtures):
  
  - **`Ranking`** — nDCG@k, recall@k, MRR@k and precision@k over a ranked list of document handles and a graded-relevance map (`Ranking.ndcg` / `recall` / `mrr` / `precision` / `scoreCase` as pure functions; `Ranking.ndcgAtK(k)` etc. as `Scorer`s over a `RankingCase`; `Ranking.metricAtK` / `metricsAtK` as `Metric`s with optional thresholds). Exponential gain, normalised against the case's own relevant set, precision divided by `k`, every scorer re-applying `k`, and the cutoff in every name (`ndcg@10`).
  - **`Runner.runRetrievalSuite`** — the retrieval counterpart of `runSuite`: a dataset of `RetrievalGolden`s, a consumer-supplied one-method `RetrievalPort` (`{ id, retrieve(query, { limit }) }`), and a cutoff `k`; returns the ordinary per-case `SuiteResult` plus a cross-query `aggregate`. Built on `runSuite`, so trials, retries, caching (keyed on the port's `id` and `k`) and reporters apply. A failed query is recorded and excluded from every mean, never scored as a zero; cases run sequentially by default.
  - **`Result.aggregate`** — per-metric means across a suite's cases (over the cases that scored), with `totalCases` / `successfulCases` / `failedCases`; useful for any suite, not only retrieval.

### Patch Changes

- 774a352: Fix the `homepage` link in every package manifest: it pointed at a `tree/main/…` path on GitHub, but the repository's default branch is `trunk`, so the link npm shows for each package 404'd. No code changes.

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
