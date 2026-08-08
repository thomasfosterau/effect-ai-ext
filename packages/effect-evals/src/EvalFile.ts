/**
 * @copyright Thomas Foster
 *
 * `EvalFile` — the contract an `*.eval.ts` file honours, shared by every
 * execution surface (starting with the CLI) so an
 * eval file itself never has to know which surface will run it: `export
 * default { suites, layer, options }` shape
 * reads the same way a CLI dynamic `import()` would. Kept in core rather
 * than any one runner adapter, so a surface can depend on this shape without
 * pulling in a test framework.
 *
 * @module EvalFile
 */

import type * as Layer from "effect/Layer";
import type { RunnerOptions, Suite } from "./Runner.ts";

/**
 * A {@link Suite} with its type parameters erased. An eval file's `suites`
 * array is deliberately heterogeneous — each suite can have its own
 * `Golden`/`Output`/error/requirement types — so there is no single
 * parameterisation that fits every entry; execution surfaces run each suite
 * through {@link Runner.runSuite} generically instead of relying on static
 * suite-shape knowledge.
 */
export type AnySuite = Suite<any, any, any, any, any, any, any, any>;

/**
 * The shape an `*.eval.ts` file default-exports: the suites to run, the
 * `Layer` providing everything those suites' combined `R` needs beyond
 * platform services (judge/provider layers, cache layer choice — see
 * `Cache.layerFileSystem` / `Cache.layerMemory`), and optional
 * {@link RunnerOptions} overrides (trials, concurrency, judge model id,
 * reporters).
 *
 * Credential gating is a runtime property of `layer`, not part of this
 * type: when building `layer` fails with a `Config.ConfigError` (a required
 * provider credential is unset), the execution surface must skip the
 * suite(s) rather than fail them.
 * `E` has no default narrower than `never` on purpose: a `Config.*`-backed
 * `layer` needs its real error type (e.g. `Config.ConfigError`, or a union
 * including it) named explicitly at the `satisfies EvalFile.EvalFile<R, E>`
 * call site, or its construction can't type-check at all.
 */
export interface EvalFile<R = never, E = never> {
  readonly suites: ReadonlyArray<AnySuite>;
  readonly layer: Layer.Layer<R, E>;
  readonly options?: RunnerOptions;
}
