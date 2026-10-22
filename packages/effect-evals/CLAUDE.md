# @thomasfosterau/effect-evals

The Effect-native LLM evaluation toolkit: goldens, eval cases, scorers, thresholds and metrics; a runner with trials, bounded concurrency, retry and a content-hashed cache; reporters; ranking, G-Eval and RAG metrics; and the `effect-evals` CLI that discovers and runs `*.eval.ts` files.

## Boundary

Peers: `effect`, and `@effect/platform-node` (optional, the CLI only). Imports nothing from this workspace (`.fallowrc.json` zone `evals`, no outbound rule). The core (the `.` barrel) imports `effect` only; `@effect/platform-node` is imported by `src/cli/main.ts` alone. Builds two entries: `src/index.ts` and the CLI, `dist/cli/main.js`.

## Invariants

- **Node type-strips this package's TypeScript**, so `tsconfig.json` sets `erasableSyntaxOnly` and type-checks `src`, `tests` and `vite.config.ts` (every other package checks `src` only), and relative imports carry `.ts`.
- **The bin is a flagless launcher with exactly one hop**: `bin/effect-evals.js` re-execs `node --disable-warning=ExperimentalWarning --import <loader.mjs> dist/cli/main.js …argv`, flags as literal argv, never `NODE_OPTIONS` or tsx. The CLI runs as built JavaScript because Node refuses to type-strip under `node_modules`; only the consumer's own `*.eval.ts` files are type-stripped. Never `--no-warnings` (it hides every warning, #81). `bin/**` and `src/cli/loader.mjs` run before any Effect runtime exists, hence their lint override.
- **Credential gating**: an eval file whose `layer` fails with a `Config.ConfigError` is reported as skipped, never failed (`Runner.isConfigError`). The CLI sets `process.exitCode = 1` only when an executed suite misses its threshold.
- **Retry only a retryable `AiError`** (`isRetryable`); any other failure is a typed trial error. A metric that fails is `Errored`, distinct from a `Scored` miss; `ignoreErrors` decides whether it drops out of the aggregate or fails the case.
- **The cache key is data, never code**: a SHA-256 (`crypto.subtle`) of the canonicalised golden, task `id`, metric name, `judgeModelId` and trial. Changing a task's or metric's behaviour means bumping its `id` / name.
- **A reporter never fails the run**: `terminal` and `json` catch their own errors and log a warning.
- **A failed retrieval query is not a zero**: it lands in `taskFailures` and is excluded from every mean; `runRetrievalSuite` is sequential by default and truncates an over-returning port to `k`.

## Terms

- **Golden** — the static, hand-authored case: input, optional expected output, context. **Eval case** — a golden plus the actuals a run produced (`output`, `retrievedContext`, `toolCalls`, `usage`); scorers read eval cases, never bare goldens.
- **Metric** — `{ name, scorer, threshold }`, the unit the runner executes; a **trial** is one end-to-end run of the task and every metric for a case.
- **Eval file** — a `*.eval.ts` default-exporting `{ suites, layer, options? }` (`EvalFile.EvalFile`).
- **Retrieval port** — the consumer-supplied `{ id, retrieve(query, { limit }) }` a retrieval suite measures; its `id` is part of the cache key.
