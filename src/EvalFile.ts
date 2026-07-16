/**
 * @copyright Thomas Foster
 *
 * `EvalFile` — the contract an `*.eval.ts` file honours, shared by every
 * execution surface (the `./viteplus` adapter, #929; the CLI, #930) so an
 * eval file itself never has to know which surface will run it: `export
 * default defineEval({ suites, layer, options })` (the `./viteplus` shape)
 * reads the same way a CLI dynamic `import()` would. Kept in core rather
 * than `./viteplus` so the CLI can depend on this shape without pulling in
 * `vite-plus/test`.
 *
 * @module EvalFile
 */

import type * as Layer from "effect/Layer";
import type { RunnerOptions, Suite } from "./Runner";

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
 * suite(s) rather than fail them — see `viteplus/index.ts`'s module docs.
 */
export interface EvalFile<R = never, E = never> {
  readonly suites: ReadonlyArray<AnySuite>;
  readonly layer: Layer.Layer<R, E>;
  readonly options?: RunnerOptions;
}
