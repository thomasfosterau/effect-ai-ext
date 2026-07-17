# @thomasfosterau/effect-evals

Effect-native LLM evaluation: goldens, scorers, thresholds, and a runner with trials, bounded concurrency, retry, and caching — expressed as plain Effect values instead of a bolted-on async framework. Designed for eventual extraction into its own repository; the core (`"."` barrel) depends on `effect` only. See [the decision doc](../../docs/decisions/effect-evals-as-the-evaluation-toolkit.md).

## Core model (#923)

- **`Golden` / `ConversationalGolden`** — the static, hand-authored description of one case: an input, an optional expected output, and whatever context a scorer needs to judge a run.
- **`EvalCase`** — a golden enriched with the actuals a run produced (`output`, `retrievedContext`, `toolCalls`, `usage`). Scorers read an `EvalCase`, never a bare `Golden` (DeepEval's golden/test-case split).
- **`Score`** — a scorer's `0..1` verdict, plus an optional `reason` and free-form `metadata`.
- **`Scorer`** — a named, Effect-returning function from an `EvalCase` to a `Score`. Judge/embedding dependencies live in `R`; failures are typed in `E`. `Scorer.contramap(scorer, from)` adapts a scorer built for one case shape to a differently-shaped case, reusing its name/`E`/`R` unchanged — exactly the variance `Scorer`'s `Case` type parameter is already declared with (`in Case`).
- **`Threshold` / `Metric`** — the pass/fail policy (`minScore` / `maxScore` / `strict`) and the `{ name, scorer, threshold }` unit a runner executes. `Metric.contramap(metric, from)` is `Scorer.contramap`'s counterpart for a metric (scorer + threshold together) — reuse a package metric like `GEval.gEval` or `EmbeddingSimilarity.embeddingSimilarity` against a case shape it wasn't written for.
- **`Dataset`** — a named, effectfully-produced source of goldens.

## Runner (#924)

`Runner.runSuite` is the Effect program every execution surface (the `./viteplus` adapter, #929; the CLI, #930) sits on:

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
- **Retries**: the task and each metric evaluation are retried independently (`taskRetrySchedule` / `metricRetrySchedule`, default a jittered exponential backoff capped at 3 attempts) — but only when the failure is an `AiError` (`effect/unstable/ai`) with `isRetryable`. Any other failure, or a non-retryable `AiError`, surfaces immediately as a typed trial error.
- **Errors vs failing scores**: a metric whose Effect fails is recorded as `Errored`, distinct from a `Scored` result that simply misses its threshold. `ignoreErrors` (default `false`) controls whether an error excludes that trial from the metric's aggregate (and doesn't affect pass/fail) or forces the metric — and the case — to fail. This mirrors DeepEval's `ignore_errors`.
- **Caching** (`Cache.ts`) is content-hash keyed (a full SHA-256 digest, via `crypto.subtle`) on the golden, the task's `id`, the metric name, `judgeModelId`, and the trial number, stored behind `effect`'s own `KeyValueStore` (`effect/unstable/persistence`). A cache hit skips both the task call and the metric's judge call for that trial. `Cache.layerMemory` is a zero-dependency in-memory store (tests, or runs with no persistence); `Cache.layerFileSystem(directory)` persists under a directory (default `Cache.defaultDirectory`, `.effect-evals/cache/`, gitignored) and requires `FileSystem`/`Path` in scope — provided by the caller (the `./viteplus` adapter or CLI), never bundled into the core. `bypassCache: true` skips cache reads and writes entirely. Invalidation is **manual, by identifier** — a task's `run` closure and a metric's `scorer`/`threshold` aren't hashed (they're code, not data), so bump `task.id` (e.g. `"translate@v1"` → `"translate@v2"`) or a metric's name/`judgeModelId` after changing its behavior, the same convention a cache-busting query string uses.

## Reporters (#924)

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

## `viteplus` adapter (#929)

`@thomasfosterau/effect-evals/viteplus` — a separate sub-export (the core `"."` barrel never imports `vite-plus/test`, see [the packaging amendment](../../docs/decisions/single-barrel-package-exports.md#second-deliberate-exception-effect-evalss-viteplus)) — runs `*.eval.ts` files under `vp test run`, evalite-style: one `describe` per suite, one `it` per case.

An `*.eval.ts` file default-exports the shared `EvalFile` contract (`src/EvalFile.ts`) — the same shape the CLI (#930) will dynamically `import()` — and registers itself with `vite-plus/test` in one expression. `defineEval` only registers tests when actually running under `vite-plus/test` (`process.env.VITEST === "true"`); a bare `import()` of the file — the CLI's use case — gets back the plain `EvalFile` object with no side effect, so the same file is safe for both surfaces:

```ts
// packages/<pkg>/evals/translation-quality.eval.ts
import { defineEval } from "@thomasfosterau/effect-evals/viteplus";
import { Dataset, Runner } from "@thomasfosterau/effect-evals";
import { anthropicLanguageModelLayer } from "./layers";

export default defineEval({
  suites: [
    Runner.makeSuite({
      name: "translation-quality",
      dataset: Dataset.fromArray("greetings", [{ input: "Bonjour", expected: "Hello" }]),
      task: Runner.makeTask({ id: "translate@v1", run: (golden) => translate(golden.input) }),
      metrics: [translationQualityMetric],
    }),
  ],
  // Everything the suites' combined `R` needs beyond platform services —
  // judge/provider layers *and* the cache layer choice (`Cache.layerMemory`
  // or `Cache.layerFileSystem`) both live here.
  layer: anthropicLanguageModelLayer,
  options: { trials: 3 },
});
```

Point a package's own vitest config at `evals/**/*.eval.ts` (a glob `packageTest`'s `include: ["tests/**/*.test.ts"]` never matches — pinned by `tests/eval-glob-separation.test.ts` — so `vp run test:unit` neither runs eval files nor needs credentials) and run it with `vp test run evals`; a per-package `evals` script wrapping that command is the suggested convention until the CLI (#930) lands.

**Credential gating.** `layer` is built exactly once, shared across every suite in the file. When that build fails with a `Config.ConfigError` (e.g. `CF_AIG_TOKEN` unset), every suite reports as **skipped** — one `it` per suite naming the missing config — never failed, so an eval file referencing a real provider is safe to leave in the tree in a credential-less checkout. A suite's own dataset/task/metric bug only fails that suite; it can't sabotage its siblings.

A failing case's message names the metric, its score against the threshold, the judge's `reason`, and the trial spread (mean/stddev/min/max).

## G-Eval judge metric (#926)

`GEval.gEval` builds a `Metric` that scores a case against an arbitrary natural-language criterion using an LLM judge (DeepEval's G-Eval), covering anything from translation quality to a bespoke house style — without writing a new metric per criterion. `GEval.gEvalConversational` is the multi-turn variant: the judge reads the full rendered turn history and scores the exchange holistically.

```ts
import { EvalCase, GEval, Golden, Metric, Threshold } from "@thomasfosterau/effect-evals";
import { LanguageModel } from "effect/unstable/ai";

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

## CLI (#930)

The `effect-evals` bin discovers and runs `*.eval.ts` suites standalone — no test framework involved. It's the surface CI invokes and the one that survives this package's eventual extraction to its own repository. It consumes the same `EvalFile` shape as the `./viteplus` adapter above (with or without the `defineEval` wrapper — a bare `import()` unwraps to the plain `{ suites, layer, options? }` object either way) and the same credential-gating semantic: a file whose `layer` fails to build with a `Config.ConfigError` is skipped, not failed.

```sh
# From this package's directory, or anywhere in the workspace once installed:
vp exec effect-evals run                                    # default glob: **/evals/**/*.eval.ts
vp exec effect-evals run packages/jobs/evals                # explicit glob(s)
vp exec effect-evals run --trials 3 --filter translation     # flags before positional globs
vp exec effect-evals run --reporter terminal                 # terminal only (default: both terminal and json)
vp exec effect-evals run --force --out ./tmp/results.json    # bypass the cache, write elsewhere
vp exec effect-evals --help                                  # full flag reference
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

**Loading strategy.** Eval files are plain TypeScript, loaded via Node's own dynamic `import()` under `--experimental-transform-types` plus this package's own extensionless-import resolution hook (`src/cli/loader.mjs`) — never tsx, consistent with [docs/decisions/run-the-toolchain-under-node.md](../../docs/decisions/run-the-toolchain-under-node.md). `bin/effect-evals.js` is a small, flagless launcher that re-execs `node` with those flags as literal argv (never `NODE_OPTIONS`) pointed at `src/cli/main.ts` — the only hop, so nothing downstream can drop them the way Alchemy's own CLI launcher does (see the decision doc).

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
| [`Runner`](src/Runner.ts) | `Suite`, `makeSuite`, `TaskDefinition`, `makeTask`, `runSuite`. |
| [`Result`](src/Result.ts) | The typed suite → case → trial → metric result model; `summarize`. |
| [`Cache`](src/Cache.ts) | `layerMemory` / `layerFileSystem`, `hashKey`. |
| [`Reporter`](src/Reporter.ts) | `Reporter`, `terminal`, `json`, `formatTerminalTable`. |
| [`GEval`](src/metrics/GEval.ts) | `gEval`, `gEvalConversational`, `makeRubric`, `defaultTemplate`. |
| [`viteplus`](src/viteplus/index.ts) | The `vite-plus/test` adapter (separate sub-export): `defineEval`, `evaluateEvalFile`, `evaluateSuite`, `formatCaseFailure`, `caseLabel`. |
| [`cli`](src/cli/) | The `effect-evals` bin — see [CLI](#cli-930) above. |

## Development

```sh
vp exec tsc -p tsconfig.json   # typecheck
vp test run tests              # unit tests
vp test run tests --coverage   # with coverage
```
