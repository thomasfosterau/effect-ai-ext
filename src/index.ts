/**
 * @module effect-evals
 *
 * The core, runner-agnostic model for `@thomasfosterau/effect-evals`: an
 * eval is definable and a scorer writable as plain Effect values, with no
 * dependency beyond `effect` itself (this barrel never imports `vite-plus` or
 * any workspace package — see
 * `docs/decisions/single-barrel-package-exports.md`). The package is slated
 * for eventual extraction into its own repository; this scaffold is the
 * foundation issue (#923) the runner, metrics, adapter, and CLI build on.
 *
 * - {@link Golden} / {@link EvalCase} — the static case and its
 *   run-enriched counterpart (DeepEval's golden/test-case split).
 * - {@link Score} — a scorer's `0..1` verdict.
 * - {@link Scorer} — a named, Effect-returning function from an
 *   `EvalCase` to a `Score`.
 * - {@link Threshold} / {@link Metric} — the pass/fail policy and the
 *   scorer+policy+name unit a runner executes.
 * - {@link Dataset} — a named source of goldens.
 * - {@link Runner} — `runSuite`, the Effect program that runs a suite's
 *   goldens through its task and metrics: trials, bounded concurrency,
 *   retry, and caching (#924).
 * - {@link Result} — the typed run → case → trial → metric result model
 *   `Runner` produces.
 * - {@link Cache} — content-hash result caching behind `effect`'s own
 *   `KeyValueStore`.
 * - {@link Reporter} — terminal and JSON sinks for a completed
 *   {@link Result.SuiteResult}.
 *
 * The `vite-plus/test` adapter lives at the separate `./viteplus`
 * sub-export so this barrel stays free of it.
 */

export * as Cache from "./Cache";
export * as Dataset from "./Dataset";
export * as EvalCase from "./EvalCase";
export * as Golden from "./Golden";
export * as Metadata from "./Metadata";
export * as Metric from "./Metric";
export * as Reporter from "./Reporter";
export * as Result from "./Result";
export * as Runner from "./Runner";
export * as Score from "./Score";
export * as Scorer from "./Scorer";
export * as Threshold from "./Threshold";
