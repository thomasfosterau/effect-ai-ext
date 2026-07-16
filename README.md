# @thomasfosterau/effect-evals

Effect-native LLM evaluation: goldens, scorers, thresholds, and a runner with trials, bounded concurrency, retry, and caching — expressed as plain Effect values instead of a bolted-on async framework. Designed for eventual extraction into its own repository; the core (`"."` barrel) depends on `effect` only. See [the decision doc](../../docs/decisions/effect-evals-as-the-evaluation-toolkit.md).

## Core model (#923)

- **`Golden` / `ConversationalGolden`** — the static, hand-authored description of one case: an input, an optional expected output, and whatever context a scorer needs to judge a run.
- **`EvalCase`** — a golden enriched with the actuals a run produced (`output`, `retrievedContext`, `toolCalls`, `usage`). Scorers read an `EvalCase`, never a bare `Golden` (DeepEval's golden/test-case split).
- **`Score`** — a scorer's `0..1` verdict, plus an optional `reason` and free-form `metadata`.
- **`Scorer`** — a named, Effect-returning function from an `EvalCase` to a `Score`. Judge/embedding dependencies live in `R`; failures are typed in `E`.
- **`Threshold` / `Metric`** — the pass/fail policy (`minScore` / `maxScore` / `strict`) and the `{ name, scorer, threshold }` unit a runner executes.
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

## What's in the box

| Module | Purpose |
| --- | --- |
| [`Golden`](src/Golden.ts) | `Golden` / `ConversationalGolden` — the static case shape. |
| [`EvalCase`](src/EvalCase.ts) | `EvalCase` — a golden enriched with run actuals; `ToolCall` / `Usage`. |
| [`Score`](src/Score.ts) | `Score` — a scorer's `0..1` verdict + reason + metadata. |
| [`Scorer`](src/Scorer.ts) | `Scorer`, `makeScorer`. |
| [`Threshold`](src/Threshold.ts) | `minScore` / `maxScore` / `strict`, `passes`. |
| [`Metric`](src/Metric.ts) | `Metric`, `makeMetric`, `evaluate`. |
| [`Dataset`](src/Dataset.ts) | `Dataset`, `makeDataset`, `fromArray`. |
| [`Runner`](src/Runner.ts) | `Suite`, `makeSuite`, `TaskDefinition`, `makeTask`, `runSuite`. |
| [`Result`](src/Result.ts) | The typed suite → case → trial → metric result model; `summarize`. |
| [`Cache`](src/Cache.ts) | `layerMemory` / `layerFileSystem`, `hashKey`. |
| [`Reporter`](src/Reporter.ts) | `Reporter`, `terminal`, `json`, `formatTerminalTable`. |

## Development

```sh
vp exec tsc -p tsconfig.json   # typecheck
vp test run tests              # unit tests
vp test run tests --coverage   # with coverage
```
