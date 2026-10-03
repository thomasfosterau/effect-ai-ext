# @thomasfosterau/effect-evals

Effect-native LLM evaluation: goldens, scorers, thresholds, and a runner with trials, bounded concurrency, retry, and caching — expressed as plain Effect values instead of a bolted-on async framework. The core (`"."` barrel) depends on `effect` only.

## Install

```sh
pnpm add @thomasfosterau/effect-evals effect
```

Requires Node `>=22.18`: the CLI loads `*.eval.ts` files with Node's type stripping, on by default from 22.18.0, and its resolution hook uses `module.registerHooks()` (22.15+). `effect` (`>=4.0.0-rc.118`) is a peer dependency. The package also ships an `effect-evals` CLI for discovering and running `*.eval.ts` suites — see [CLI](#cli) below. The CLI additionally needs the **optional** peer `@effect/platform-node` (`>=4.0.0-rc.118`): install it at the same version as `effect`, and pin `@effect/platform-node-shared` to that version too (a direct dependency or an `overrides` entry). Upstream's `^` range otherwise floats it to the newest rc, whose own `effect` peer rejects an older `effect`.

```sh
pnpm add @effect/platform-node@<your effect version> @effect/platform-node-shared@<your effect version>
```

## Core model

- **`Golden` / `ConversationalGolden`** — the static, hand-authored description of one case: an input, an optional expected output, and whatever context a scorer needs to judge a run.
- **`EvalCase`** — a golden enriched with the actuals a run produced (`output`, `retrievedContext`, `toolCalls`, `usage`). Scorers read an `EvalCase`, never a bare `Golden` (DeepEval's golden/test-case split).
- **`Score`** — a scorer's `0..1` verdict, plus an optional `reason` and free-form `metadata`.
- **`Scorer`** — a named, Effect-returning function from an `EvalCase` to a `Score`. Judge/embedding dependencies live in `R`; failures are typed in `E`. `Scorer.contramap(scorer, from)` adapts a scorer built for one case shape to a differently-shaped case, reusing its name/`E`/`R` unchanged — exactly the variance `Scorer`'s `Case` type parameter is already declared with (`in Case`).
- **`Threshold` / `Metric`** — the pass/fail policy (`minScore` / `maxScore` / `strict`) and the `{ name, scorer, threshold }` unit a runner executes. `Metric.contramap(metric, from)` is `Scorer.contramap`'s counterpart for a metric (scorer + threshold together) — reuse a package metric like `GEval.gEval` or `EmbeddingSimilarity.embeddingSimilarity` against a case shape it wasn't written for.
- **`Dataset`** — a named, effectfully-produced source of goldens.

## Runner

`Runner.runSuite` is the Effect program every execution surface sits on:

```ts
import * as Effect from "effect/Effect";
import {
  Cache,
  Dataset,
  Metric,
  Reporter,
  Runner,
  Scorer,
  Threshold,
} from "@thomasfosterau/effect-evals";

const suite = Runner.makeSuite({
  name: "translation-quality",
  dataset: Dataset.fromArray("greetings", [{ input: "Bonjour", expected: "Hello" }]),
  task: Runner.makeTask({
    id: "translate@claude-sonnet-5",
    run: (golden) => translate(golden.input),
  }),
  metrics: [
    Metric.makeMetric({
      name: "exact-match",
      scorer: Scorer.makeScorer({
        name: "exact-match",
        evaluate: (evalCase) =>
          Effect.succeed({ score: evalCase.golden.expected === evalCase.output ? 1 : 0 }),
      }),
      threshold: Threshold.strict,
    }),
  ],
});

const result = await Effect.runPromise(
  Runner.runSuite(suite, {
    trials: 3,
    reporters: [Reporter.terminal, Reporter.json("./results.json")],
  }).pipe(Effect.provide(Cache.layerMemory)),
);
```

- **Heterogeneous `metrics`.** `makeSuite`'s `metrics` array can freely mix metrics with different `E`/`R` — a G-Eval judge (`GEvalError`/`LanguageModel`) alongside an `embeddingSimilarity` metric (`AiError`/`EmbeddingModel`), say — with no explicit array type annotation at the call site: the `metrics` array literal is inferred as a literal tuple (a `const` type parameter) and `MetricE`/`MetricR` are unioned across its elements, rather than fixed from the first one.
- **Concurrency** is bounded independently at the case level (`caseConcurrency`, default `5`) and the metric level (`metricConcurrency`, default `5`) via `Effect.forEach({ concurrency })`.
- **Trials**: each case runs `trials` times (default `1`) end to end — task and every metric. A metric's aggregate reports `mean`/`variance`/`stddev`/`min`/`max` across its trials, with every per-trial score kept so flakiness is visible; pass/fail applies the metric's `Threshold` to the mean.
- **Retries**: the task and each metric evaluation are retried independently (`taskRetrySchedule` / `metricRetrySchedule`, default a jittered exponential backoff capped at 3 attempts) — but only when the failure is an `AiError` (`effect/ai`) with `isRetryable`. Any other failure, or a non-retryable `AiError`, surfaces immediately as a typed trial error.
- **Errors vs failing scores**: a metric whose Effect fails is recorded as `Errored`, distinct from a `Scored` result that simply misses its threshold. `ignoreErrors` (default `false`) controls whether an error excludes that trial from the metric's aggregate (and doesn't affect pass/fail) or forces the metric — and the case — to fail. This mirrors DeepEval's `ignore_errors`.
- **Caching** (`Cache.ts`) is content-hash keyed (a full SHA-256 digest, via `crypto.subtle`) on the golden, the task's `id`, the metric name, `judgeModelId`, and the trial number, stored behind `effect`'s own `KeyValueStore` (`effect/persistence`). A cache hit skips both the task call and the metric's judge call for that trial. `Cache.layerMemory` is a zero-dependency in-memory store (tests, or runs with no persistence); `Cache.layerFileSystem(directory)` persists under a directory (default `Cache.defaultDirectory`, `.effect-evals/cache/`, gitignored) and requires `FileSystem`/`Path` in scope — provided by the caller (the `./viteplus` adapter or CLI), never bundled into the core. `bypassCache: true` skips cache reads and writes entirely. Invalidation is **manual, by identifier** — a task's `run` closure and a metric's `scorer`/`threshold` aren't hashed (they're code, not data), so bump `task.id` (e.g. `"translate@v1"` → `"translate@v2"`) or a metric's name/`judgeModelId` after changing its behavior, the same convention a cache-busting query string uses.

## Reporters

`Reporter` is a named sink for a completed `Result.SuiteResult`; a reporter never fails the run — `terminal` and `json` both catch their own errors and log a warning instead.

- **`Reporter.terminal`** — a plain-text table to stdout: one row per case per metric (`pass/fail`, mean/spread, the last reason).
- **`Reporter.json(path)`** — the full result model as JSON, written via `effect`'s `FileSystem` service (so it's testable with `FileSystem.layerNoop`, no real disk needed).

### JSON schema

```json
{
  "suite": "string",
  "passed": true,
  "durationMillis": 1234,
  "cases": [
    {
      "golden": "<the golden, as-is>",
      "trials": 3,
      "passed": true,
      "taskFailures": [{ "trial": 2, "error": "<the task's typed error>" }],
      "metrics": [
        {
          "metric": "exact-match",
          "passed": true,
          "errorCount": 0,
          "summary": { "mean": 0.8, "variance": 0.01, "stddev": 0.1, "min": 0.7, "max": 0.9 },
          "trials": [
            {
              "_tag": "Scored",
              "trial": 1,
              "cached": false,
              "score": { "score": 0.8, "reason": "..." }
            },
            {
              "_tag": "Errored",
              "trial": 2,
              "cached": false,
              "error": "<the metric's typed error>"
            }
          ]
        }
      ]
    }
  ]
}
```

`summary` is `null` when every trial for that metric errored (no scores to summarize). `taskFailures` is empty unless the task itself failed for some trial, in which case that trial contributes to no metric's `trials` array at all (there was no output to score).

## Retrieval ranking metrics

`Ranking` scores a **ranked list of document handles** against a **graded relevance map** — nDCG@k, recall@k, MRR@k and precision@k — as deterministic, judge-free scorers. Grades are positive numbers (`1`–`3` by convention: `3` is the answer, `2` would satisfy, `1` is better than nothing); a handle absent from the map is non-relevant. nDCG uses exponential gain (`2^grade − 1`) and normalises against the case's own relevant set, so a case with two relevant documents and `k = 20` can still score 1; precision divides by `k`, not by how many rows came back; MRR and recall are bounded by the page. Every scorer re-applies `k` itself, and its name carries the cutoff (`ndcg@10`, never `ndcg`) because `ndcg@10` and `ndcg@20` are different measurements.

```ts
import { Ranking, Threshold } from "@thomasfosterau/effect-evals";

// The pure functions, over { ranked, relevant, k }:
Ranking.ndcg({ ranked: ["b", "a"], relevant: { a: 3, b: 1 }, k: 5 }); // 0.7098…
Ranking.scoreCase({ ranked, relevant, k: 10 }); // { "ndcg@10": …, "recall@10": …, "mrr@10": …, "precision@10": … }

// As Scorers / Metrics over a RankingCase ({ golden: { relevant }, output: ranked }):
Ranking.ndcgAtK(10); // Scorer named "ndcg@10"
Ranking.metricsAtK(10, { thresholds: { ndcg: Threshold.minScore(0.8) } }); // all four, one gated
```

### `Runner.runRetrievalSuite`

The retrieval counterpart of `runSuite`: a dataset of `RetrievalGolden`s (`{ query, relevant, name? }`), a one-method `RetrievalPort` the consumer supplies, and a cutoff `k`. The port is the seam — the thing being measured (a search operation, a reranker chain) lives in the consumer, the suite hands it each query and the page size, and reads back handles best-first. That is also what makes an offline mode the same code path as a credentialed one: a unit suite hands in an in-memory port over fixed orderings, an operator hands in one closing over a live search, and the runner cannot tell.

```ts
import * as Effect from "effect/Effect";
import { Cache, Dataset, Runner, Threshold } from "@thomasfosterau/effect-evals";

const port: Runner.RetrievalPort<SearchError, Database> = {
  id: "search@rerank-v3.5", // the configuration under test; part of the cache key
  retrieve: (query, { limit }) => search({ query, limit }).pipe(Effect.map((rows) => rows.map(handleOf))),
};

const result = await Effect.runPromise(
  Runner.runRetrievalSuite(
    {
      name: "search-ranking-smoke",
      dataset: Dataset.fromArray("search-ranking-smoke", [
        { name: "genus", query: "monstera", relevant: { "taxon:monstera": 3, "taxon:monstera-x": 1 } },
      ]),
      port,
      k: 20,
      metrics: { thresholds: { ndcg: Threshold.minScore(0.8) } }, // optional; all four metrics, never failing, by default
    },
    { reporters: [Reporter.terminal] },
  ).pipe(Effect.provide(Cache.layerMemory), Effect.provide(databaseLayer)),
);

result.aggregate.metrics["ndcg@20"]; // { mean, cases } across the queries that scored
result.cases[0]?.metrics; // the ordinary per-case, per-metric result model
```

- **Built on `runSuite`**, so trials, retry on retryable `AiError`s, caching (keyed on the port's `id` and `k` — bump `id` when the port's behaviour changes) and reporters all apply, and the result is the ordinary `Result.SuiteResult` plus `aggregate: Result.aggregate(result)` — per-metric means across the queries that scored, with `totalCases` / `successfulCases` / `failedCases`.
- **A failed query is not a zero.** A retrieval failure lands in that case's `taskFailures`, is excluded from every mean, and is counted in `aggregate.failedCases`; a suite in which every query failed has an empty `aggregate.metrics` and `passed: false`, never a page of noughts.
- **Sequential by default** (`caseConcurrency: 1`): a retrieval suite usually runs against a live search plane, and measuring it under a load pattern no user produces makes any latency the port records meaningless. Pass `caseConcurrency` to change it.
- **Over-returning ports are truncated** to `k` before scoring, and every metric re-applies `k` — a retrieval that returns more than it was asked for cannot inflate recall.
- **What stays with the consumer:** dataset validation and content digests (which runs are comparable), per-query latency, persistence, and the run-to-run diff. `Result.aggregate` and `Result.SuiteResult` are plain values a consumer can persist or diff as it likes.

## G-Eval judge metric

`GEval.gEval` builds a `Metric` that scores a case against an arbitrary natural-language criterion using an LLM judge (DeepEval's G-Eval), covering anything from translation quality to a bespoke house style — without writing a new metric per criterion. `GEval.gEvalConversational` is the multi-turn variant: the judge reads the full rendered turn history and scores the exchange holistically.

```ts
import { EvalCase, GEval, Golden, Metric, Threshold } from "@thomasfosterau/effect-evals";
import { LanguageModel } from "effect/ai";

const TranslationGolden = Golden.Golden(Schema.String, Schema.String);
const TranslationCase = EvalCase.EvalCase(TranslationGolden, Schema.String);

const translationQuality = GEval.gEval<typeof TranslationCase.Type>({
  name: "translation-quality",
  criteria: "Is this a faithful, fluent translation of the source?",
  evaluationParams: ["input", "output"],
  threshold: Threshold.minScore(0.7),
});

// The judge LanguageModel is provided the same way any other service is —
// Layer.provide at the call site, swappable per metric or per environment.
const result = await Effect.runPromise(
  Metric.evaluate(translationQuality, evalCase).pipe(Effect.provide(anthropicLanguageModelLayer)),
);
```

`gEval` accepts `criteria` **or** `evaluationSteps`, never both:

- `criteria` — a natural-language description; the judge derives its own evaluation steps per run (convenient) and reports them back, so the steps actually used still land in `Score.metadata.evaluationSteps` even though they weren't authored ahead of time.
- `evaluationSteps` — an explicit, ordered list you write yourself. No derivation call: the judge is told exactly what to check.

`evaluationParams` names which fields of the case the judge is shown (`"input" | "output" | "expected" | "context" | "retrievedContext"`); asking for a field a given case doesn't have fails with the typed `GEval.MissingEvaluationParamError` rather than throwing or silently skipping it. `GEval.gEvalConversational` takes the same `criteria`/`evaluationSteps` shape over `"scenario" | "expectedOutcome" | "context"` (the turn history itself is always shown).

An optional `rubric` (`GEval.makeRubric`) constrains the judge to non-overlapping score bands on whatever scale you write them in (DeepEval's convention is `0..10`); `gEval` clamps the judge's raw score to the rubric's range and normalises it to `Score`'s `0..1`. An overlapping or malformed rubric throws immediately at construction — it's a mistake in the metric definition, not a per-case condition.

`template` overrides the judge's system/user prompt wording (see `GEval.defaultTemplate`) without forking the metric.

### Determinism levers

An LLM judge is inherently noisy; DeepEval and this package both lean on the same three levers rather than log-prob weighting (`generateObject` doesn't expose token log-probabilities, so that avenue is closed regardless):

1. **Explicit `evaluationSteps`.** Skips the criteria-to-steps derivation call, so every run judges against literally the same instructions instead of a fresh (and possibly inconsistent) derivation each time.
2. **A `rubric`.** Non-overlapping bands with descriptions narrow the judge's scoring range to discrete, justified buckets instead of an unconstrained continuous guess.
3. **Trials.** Running a metric several times per case and aggregating (mean/variance, flakiness surfacing) is the runner's job (above), not this metric — `gEval` and `gEvalConversational` score a single run; the runner is what repeats that run and aggregates the results.

Combine all three for the most reproducible signal: explicit steps and a rubric pin down _what_ is being judged, and trials reveal _how consistently_ the judge applies them.

## CLI

The `effect-evals` bin discovers and runs `*.eval.ts` suites standalone — no test framework involved. It's the surface CI invokes. An `*.eval.ts` file default-exports the `EvalFile` contract (`src/EvalFile.ts`) — the plain `{ suites, layer, options? }` object — which the CLI dynamically `import()`s. Credential gating applies: a file whose `layer` fails to build with a `Config.ConfigError` is skipped, not failed, so an eval file referencing a real provider is safe to leave in the tree in a credential-less checkout.

```sh
# From this package's directory, or anywhere in the workspace once installed:
pnpm effect-evals run                                    # default glob: **/evals/**/*.eval.ts
pnpm effect-evals run packages/my-pkg/evals                # explicit glob(s)
pnpm effect-evals run --trials 3 --filter translation     # flags before positional globs
pnpm effect-evals run --reporter terminal                 # terminal only (default: both terminal and json)
pnpm effect-evals run --force --out ./tmp/results.json    # bypass the cache, write elsewhere
pnpm effect-evals --help                                  # full flag reference
```

| Flag | Effect |
| --- | --- |
| `[globs...]` (positional) | Glob patterns to match `*.eval.ts` files. Default: `**/evals/**/*.eval.ts` from cwd. |
| `--trials <n>` | Overrides every matched suite's `trials` (and the eval file's own `options.trials`). |
| `--concurrency <n>` | Overrides both `caseConcurrency` and `metricConcurrency`. |
| `--force` | Bypasses the result cache for this run. |
| `--reporter json\|terminal` | Repeatable. Which reporter(s) to produce; both run when omitted. |
| `--filter <substring>` | Only runs suites whose name contains this substring. |
| `--out <path>` | Where the JSON reporter writes its combined report. Default `.effect-evals/results.json`. |

**Exit code** is non-zero iff any _executed_ suite misses its threshold — a suite skipped for missing credentials never fails the run, but is listed in both the terminal output (a `SKIP` line) and the JSON report's `skipped` array.

**Loading strategy.** Eval files are plain TypeScript, loaded via Node's own dynamic `import()` (type stripping is on by default from Node 22.18; eval files must be erasable-syntax-only) plus this package's own extensionless-import resolution hook (`src/cli/loader.mjs`, installed in-thread with `module.registerHooks()`) — never tsx, consistent with [docs/decisions/run-the-toolchain-under-node.md](../../docs/decisions/run-the-toolchain-under-node.md). `bin/effect-evals.js` is a small, flagless launcher that re-execs `node` with those flags as literal argv (never `NODE_OPTIONS`) pointed at the built CLI, `dist/cli/main.js` (Node refuses to type-strip under `node_modules`, so only your own `*.eval.ts` files are type-stripped, never the package) — the only hop, so nothing downstream can drop them the way Alchemy's own CLI launcher does (see the decision doc).

## What's in the box

| Module | Purpose |
| --- | --- |
| [`Golden`](src/Golden.ts) | `Golden` / `ConversationalGolden` — the static case shape. |
| [`EvalCase`](src/EvalCase.ts) | `EvalCase` — a golden enriched with run actuals; `ToolCall` / `Usage`. |
| [`Score`](src/Score.ts) | `Score` — a scorer's `0..1` verdict + reason + metadata. |
| [`Scorer`](src/Scorer.ts) | `Scorer`, `makeScorer`, `contramap`. |
| [`Threshold`](src/Threshold.ts) | `minScore` / `maxScore` / `strict`, `passes`, `describe`. |
| [`Metric`](src/Metric.ts) | `Metric`, `makeMetric`, `evaluate`, `contramap`. |
| [`Dataset`](src/Dataset.ts) | `Dataset`, `makeDataset`, `fromArray`. |
| [`EvalFile`](src/EvalFile.ts) | The `*.eval.ts` contract shared by every execution surface: `EvalFile`, `AnySuite`. |
| [`Runner`](src/Runner.ts) | `Suite`, `makeSuite`, `TaskDefinition`, `makeTask`, `runSuite`; `RetrievalPort`, `RetrievalGolden`, `runRetrievalSuite`. |
| [`Result`](src/Result.ts) | The typed suite → case → trial → metric result model; `summarize`, `aggregate`. |
| [`Cache`](src/Cache.ts) | `layerMemory` / `layerFileSystem`, `hashKey`. |
| [`Reporter`](src/Reporter.ts) | `Reporter`, `terminal`, `json`, `formatTerminalTable`. |
| [`Ranking`](src/metrics/Ranking.ts) | `ndcg` / `recall` / `mrr` / `precision`, `scoreCase`, `metricKey`; `ndcgAtK` … as scorers, `metricAtK` / `metricsAtK`. |
| [`GEval`](src/metrics/GEval.ts) | `gEval`, `gEvalConversational`, `makeRubric`, `defaultTemplate`. |
| [`RagCase`](src/metrics/rag/RagCase.ts) | `RagCase` — the case shape the RAG metrics read (`input`, `output`, `expected`, `retrievedContext`); `require…` field lookups, `renderContext`. |
| [`ExtractThenClassify`](src/metrics/rag/ExtractThenClassify.ts) | The extract → classify → ratio judge primitive the RAG metrics share: `extractStatements`, `classifyStatements`, `extractThenClassifyRatio`. |
| [`Faithfulness`](src/metrics/rag/Faithfulness.ts) / [`AnswerRelevancy`](src/metrics/rag/AnswerRelevancy.ts) / [`ContextualPrecision`](src/metrics/rag/ContextualPrecision.ts) / [`ContextualRecall`](src/metrics/rag/ContextualRecall.ts) / [`ContextualRelevancy`](src/metrics/rag/ContextualRelevancy.ts) | Judge-based RAG metrics over `RagCase`: `faithfulness`, `answerRelevancy`, `contextualPrecision`, `contextualRecall`, `contextualRelevancy`. |
| [`ExactMatch`](src/scorers/ExactMatch.ts) / [`Levenshtein`](src/scorers/Levenshtein.ts) / [`JsonValidity`](src/scorers/JsonValidity.ts) / [`SchemaMatch`](src/scorers/SchemaMatch.ts) | Deterministic scorers: `exactMatch` / `normalizedMatch`, `levenshtein` / `levenshteinSimilarity`, `jsonValidity`, `schemaMatch` / `schemaMatchValue`. |
| [`ToolCallCorrectness`](src/scorers/ToolCallCorrectness.ts) | `toolCallCorrectness` — a case's actual tool calls against its golden's `expectedTools`. |
| [`EmbeddingSimilarity`](src/scorers/EmbeddingSimilarity.ts) | `embeddingSimilarity` — cosine similarity of `output` and `expected` through the ambient `EmbeddingModel`. |
| [`Metadata`](src/Metadata.ts) | `Metadata` — the free-form record a golden, scorer or score carries. |
| [`cli`](src/cli/) | The `effect-evals` bin — see [CLI](#cli) above. |

## License

MIT
