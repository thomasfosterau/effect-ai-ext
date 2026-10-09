/**
 * The one Vite+ configuration every package in this workspace shares: the
 * task graph (`check`, `build`, `test:unit`, `test:coverage`, `docgen`), the
 * `vp pack` (tsdown) settings and the vitest / coverage settings. Each
 * `packages/<name>/vite.config.ts` is a one-call instantiation of it.
 *
 * Copied from the effect-web library's `vite.package.ts` and adapted to this
 * repo's layout, where a package's development `exports` point at `src/`
 * (`publishConfig` rewrites them to `dist/` on publish). So a test or a type
 * check that imports a package by name, its own or a sibling's, resolves to
 * `src/` through `exports` with no alias and no build first, and only
 * `docgen`, which runs its examples against `dist/`, carries a build edge. Vite+ 1.0 nests a task's `env` /
 * `input` / `output` under `cache` (effect-web, on 0.3.x, sets them on the
 * task itself).
 */
import { defineConfig } from "vite-plus";

/** One Istanbul threshold per metric, in percent. */
export interface CoverageThresholds {
  readonly lines: number;
  readonly branches: number;
  readonly functions: number;
  readonly statements: number;
}

/**
 * The coverage every package ratchets toward: effect-web's thresholds, the
 * family standard (#100). A package that omits a metric from its
 * `coverageFloor` is held to the value here.
 */
export const coverageTarget: CoverageThresholds = {
  lines: 90,
  branches: 85,
  functions: 90,
  statements: 90,
};

/**
 * A package's ratchet: the coverage it must not drop below, set from its own
 * measured numbers rounded down to the integer (#100). Raise a metric whenever
 * the package's coverage rises; delete it to fall back to `coverageTarget`.
 * Never lower one to make a change pass: add the tests instead.
 */
export type CoverageFloor = Partial<CoverageThresholds>;

/** A package's enforced thresholds: its floor, the target for any metric it omits. */
export const resolveCoverageThresholds = (floor: CoverageFloor = {}): CoverageThresholds => ({
  ...coverageTarget,
  ...floor,
});

/** What differs per package. */
export interface PackageConfigOptions {
  /**
   * `pack.entry`: output name (without extension) → source file. One entry per
   * `publishConfig.exports` subpath (plus the `effect-evals` CLI), so the
   * built file names match what `publishConfig` points at.
   */
  readonly entry: Readonly<Record<string, string>>;
  /** Extra coverage exclusions (beyond declaration files). */
  readonly coverageExclude?: ReadonlyArray<string> | undefined;
  /**
   * The package's coverage ratchet (see `CoverageFloor`). Declared as the
   * `coverageFloor` named export of the package's `vite.config.ts`. The gate is
   * `vp run -r test:coverage`, which measures each package with only its own
   * tests. The root config also reads it for its per-package glob thresholds,
   * a weaker extra check: same numbers, but measured with every package's
   * tests, so another package's tests can hide a drop.
   */
  readonly coverageFloor?: CoverageFloor;
}

/**
 * Input fingerprint for a package's cached tasks: auto tracking minus
 * node_modules bookkeeping churn (pnpm rewrites `.modules.yaml` on every
 * install), with the lockfile back explicitly so a dependency upgrade still
 * invalidates a type-check or a test run.
 */
const cacheInputs = [
  { auto: true },
  "!node_modules/**",
  { pattern: "!node_modules/**", base: "workspace" as const },
  { pattern: "pnpm-lock.yaml", base: "workspace" as const },
];

export const packageConfig = ({
  entry,
  coverageExclude = [],
  coverageFloor,
}: PackageConfigOptions) => {
  const maxWorkers = process.env.VITEST_MAX_WORKERS;
  return defineConfig({
    run: {
      tasks: {
        // `tsconfig.json` under the native, Effect-patched `tsc` (`src` only,
        // except `effect-evals`, whose tsconfig also covers its tests and
        // configs).
        check: {
          command: "tsc -p tsconfig.json",
          cache: { input: cacheInputs, output: [] },
        },
        // The published artifact: one ESM bundle + declaration file per entry
        // point (`vp pack` → tsdown). `sideEffects: false` is a claim about
        // this output: no top-level statements.
        build: {
          command: "vp pack",
          cache: { input: cacheInputs, output: ["dist/**"] },
        },
        "test:unit": {
          command: "vp test run tests",
          cache: { env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"], input: cacheInputs, output: [] },
        },
        "test:coverage": {
          command: "vp test run tests --coverage",
          cache: {
            env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
            input: cacheInputs,
            output: ["coverage/**"],
          },
        },
        // Compiles AND RUNS every JSDoc `@example` (see the package's
        // docgen.json), then writes the API reference under its git-ignored
        // `docs/`. Examples import packages by name, exactly as a consumer
        // would; development `exports` here point at `src/`, so each
        // docgen.json maps those names onto `dist/` through
        // `examplesCompilerOptions.paths` (honoured by both the examples' `tsc`
        // and the `tsx` that runs them). Hence the build edges: the package's
        // own and its workspace dependencies' (`@thomasfosterau/effect-ai-ext`).
        docgen: {
          command: "docgen",
          dependsOn: ["build", { task: "build", from: "dependencies" }],
          cache: { input: cacheInputs, output: ["docs/**"] },
        },
      },
    },
    pack: {
      entry: { ...entry },
      format: "esm",
      platform: "neutral",
      // The tsup build this replaced emitted untranspiled `esnext`; without
      // this tsdown would lower syntax to `engines.node` where a package
      // declares one.
      target: "esnext",
      dts: true,
      outDir: "dist",
      clean: true,
      deps: {
        // `effect`, `@effect/*` and the workspace `@thomasfosterau/*` packages
        // stay external so the published package shares the consumer's
        // singleton copies; `@cloudflare/*` (the gateway's optional,
        // types-only peer) has no runtime presence to bundle; `node:*`
        // builtins (the `effect-evals` CLI) are the runtime's own, and naming
        // them here keeps the `neutral` platform from reporting them as
        // unresolved imports.
        neverBundle: [
          /^effect(\/|$)/,
          /^@effect\//,
          /^@thomasfosterau\//,
          /^@cloudflare\//,
          /^node:/,
        ],
      },
    },
    test: {
      // Narrow on purpose: `effect-evals`' `tests/eval-glob-separation.test.ts`
      // pins this exact value so the unit suite can never start picking up
      // `*.eval.ts` files, which may need real provider credentials to run.
      include: ["tests/**/*.test.ts"],
      testTimeout: 30_000,
      ...(maxWorkers === undefined ? {} : { maxWorkers: Number(maxWorkers) }),
      coverage: {
        provider: "istanbul",
        // `json` writes coverage-final.json, the Istanbul map `fallow audit`
        // reads for exact per-function CRAP scores (`health.coverage` in
        // .fallowrc.json); without it every function scores as uncovered.
        reporter: ["text-summary", "json-summary", "json"],
        reportsDirectory: "./coverage",
        include: ["src/**/*.ts"],
        exclude: ["**/*.d.ts", ...coverageExclude],
        // A coverage drop below the package's floor fails the run (#100).
        // Vitest reads `coverage` from the root config only, so this binds the
        // per-package `test:coverage` task; the root task applies the same
        // floors per package through glob thresholds (root `vite.config.ts`).
        thresholds: { ...resolveCoverageThresholds(coverageFloor) },
      },
    },
  });
};
