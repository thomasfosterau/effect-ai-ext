/**
 * @module effect-evals
 *
 * The core, runner-agnostic model for `@thomasfosterau/effect-evals`: an
 * eval is definable and a scorer writable as plain Effect values, with no
 * dependency beyond `effect` itself (this barrel never imports `vite-plus` or
 * any workspace package — see
 * `docs/decisions/single-barrel-package-exports.md`). The package is slated
 * for eventual extraction into its own repository; this is the foundation
 * (#923) the runner, metrics, adapter, and CLI build on.
 *
 * - {@link Golden} / {@link EvalCase} — the static case and its
 *   run-enriched counterpart (DeepEval's golden/test-case split).
 * - {@link Score} — a scorer's `0..1` verdict.
 * - {@link Scorer} — a named, Effect-returning function from an
 *   `EvalCase` to a `Score`; `contramap` adapts one to a differently-shaped
 *   case.
 * - {@link Threshold} / {@link Metric} — the pass/fail policy and the
 *   scorer+policy+name unit a runner executes; {@link Metric.contramap} is
 *   `Scorer.contramap`'s counterpart at the `Metric` level.
 * - {@link Dataset} — a named source of goldens.
 * - {@link EvalFile} — the `*.eval.ts` contract shared by every execution
 *   surface (the `./viteplus` adapter and the CLI).
 * - {@link Runner} — `runSuite`, the Effect program that runs a suite's
 *   goldens through its task and metrics: trials, bounded concurrency,
 *   retry, and caching (#924).
 * - {@link Result} — the typed run → case → trial → metric result model
 *   `Runner` produces.
 * - {@link Cache} — content-hash result caching behind `effect`'s own
 *   `KeyValueStore`.
 * - {@link Reporter} — terminal and JSON sinks for a completed
 *   {@link Result.SuiteResult}.
 * - The deterministic scorer catalog ({@link ExactMatch}, {@link Levenshtein},
 *   {@link JsonValidity}, {@link SchemaMatch}, {@link EmbeddingSimilarity},
 *   {@link ToolCallCorrectness}) — judge-free, reproducible {@link Scorer}s
 *   built on the primitive above (#925).
 * - {@link GEval} — the arbitrary-criteria LLM judge metric (single- and
 *   multi-turn).
 * - The RAG metric suite ({@link Faithfulness}, {@link AnswerRelevancy},
 *   {@link ContextualPrecision}, {@link ContextualRecall},
 *   {@link ContextualRelevancy}) — judge-based metrics for
 *   retrieval-augmented answers, built on the shared {@link RagCase} case
 *   shape and {@link ExtractThenClassify} extract → classify → ratio
 *   primitive (#927).
 * - {@link EvalFile} — the `*.eval.ts` default-export contract shared by
 *   both execution surfaces (the CLI, #930; the `./viteplus` adapter, #929).
 *
 * The `vite-plus/test` adapter lives at the separate `./viteplus`
 * sub-export so this barrel stays free of it.
 */

export * as AnswerRelevancy from "./metrics/rag/AnswerRelevancy.ts";
export * as Cache from "./Cache.ts";
export * as ContextualPrecision from "./metrics/rag/ContextualPrecision.ts";
export * as ContextualRecall from "./metrics/rag/ContextualRecall.ts";
export * as ContextualRelevancy from "./metrics/rag/ContextualRelevancy.ts";
export * as Dataset from "./Dataset.ts";
export * as EvalCase from "./EvalCase.ts";
export * as EvalFile from "./EvalFile.ts";
export * as ExtractThenClassify from "./metrics/rag/ExtractThenClassify.ts";
export * as Faithfulness from "./metrics/rag/Faithfulness.ts";
export * as GEval from "./metrics/GEval.ts";
export * as Golden from "./Golden.ts";
export * as Metadata from "./Metadata.ts";
export * as Metric from "./Metric.ts";
export * as RagCase from "./metrics/rag/RagCase.ts";
export * as Reporter from "./Reporter.ts";
export * as Result from "./Result.ts";
export * as Runner from "./Runner.ts";
export * as Score from "./Score.ts";
export * as Scorer from "./Scorer.ts";
export * as Threshold from "./Threshold.ts";

export * as EmbeddingSimilarity from "./scorers/EmbeddingSimilarity.ts";
export * as ExactMatch from "./scorers/ExactMatch.ts";
export * as JsonValidity from "./scorers/JsonValidity.ts";
export * as Levenshtein from "./scorers/Levenshtein.ts";
export * as SchemaMatch from "./scorers/SchemaMatch.ts";
export * as ToolCallCorrectness from "./scorers/ToolCallCorrectness.ts";
