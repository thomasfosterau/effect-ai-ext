/**
 * Root workspace config. Owns the repo-wide format/lint/staged passes (read
 * statically by `vp fmt` / `vp lint` / `vp staged`) and the root aggregates
 * (`check`, `check:dist`, `test:coverage`). Every package's own tasks are
 * defined once in `vite.package.ts` and instantiated by each package's
 * `vite.config.ts`; this file compiles nothing, but a new package adds itself
 * to the aggregate lists below.
 *
 * Copied from the effect-web library's root config (itself from
 * effect-drizzle-ext and the gardeneria application): every comment that
 * explains a load-bearing decision is part of the standard and travels with
 * the config. This repo has no `docgen` task yet (#99).
 *
 * @copyright Thomas Foster
 */

import { defineConfig } from "vite-plus";
import { recommended } from "@effect/tsgo/oxlint-presets";
import effect from "@mpsuesser/oxlint-plugin-effect";
import { type CoverageFloor, resolveCoverageThresholds } from "./vite.package.ts";
import { coverageFloor as cohereFloor } from "./packages/effect-ai-cohere/vite.config.ts";
import { coverageFloor as elevenlabsFloor } from "./packages/effect-ai-elevenlabs/vite.config.ts";
import { coverageFloor as extFloor } from "./packages/effect-ai-ext/vite.config.ts";
import { coverageFloor as gatewayFloor } from "./packages/effect-ai-gateway/vite.config.ts";
import { coverageFloor as mistralFloor } from "./packages/effect-ai-mistral/vite.config.ts";
import { coverageFloor as voyageFloor } from "./packages/effect-ai-voyage/vite.config.ts";
import { coverageFloor as evalsFloor } from "./packages/effect-evals/vite.config.ts";

/**
 * Each package's coverage ratchet (#100), keyed by its directory. The floors
 * live next to each package's config; listing them here makes the root
 * `test:coverage` run enforce them package by package, as glob thresholds,
 * because Vitest reads `coverage` from the root config only and ignores the
 * projects' own.
 */
const coverageFloors = {
  "effect-ai-cohere": cohereFloor,
  "effect-ai-elevenlabs": elevenlabsFloor,
  "effect-ai-ext": extFloor,
  "effect-ai-gateway": gatewayFloor,
  "effect-ai-mistral": mistralFloor,
  "effect-ai-voyage": voyageFloor,
  "effect-evals": evalsFloor,
} satisfies Readonly<Record<string, CoverageFloor>>;

export default defineConfig({
  // Staged-file checks run by `vp staged` (pre-commit).
  staged: {
    "*.{js,ts,css,json,md}": "vp check --fix",
  },
  fmt: {
    // CHANGELOG.md files are written by `changeset version` and never
    // hand-edited, so the formatter leaves them as Changesets wrote them.
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**", "**/CHANGELOG.md"],
    overrides: [
      {
        files: ["**/*.md"],
        options: {
          proseWrap: "never",
        },
      },
    ],
  },
  lint: {
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**", "**/node_modules/**"],
    extends: [recommended, effect.configs.recommended],
    categories: {
      correctness: "error",
    },
    rules: {
      "eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "eslint/prefer-const": "warn",
      // The `Buffer` global is typed `any` wherever a consumer loads
      // @cloudflare/workers-types next to @types/node (every application this
      // family serves), so every call on it is unchecked there. Use
      // Uint8Array / TextEncoder / DataView instead.
      "eslint/no-restricted-globals": [
        "error",
        {
          name: "Buffer",
          message:
            "The `Buffer` global is typed `any` wherever @cloudflare/workers-types is loaded. Use Uint8Array / TextEncoder / DataView.",
        },
      ],
      // `casting-awareness` is an awareness prompt, not a defect rule — it
      // fires on every `as`, including the narrowings the Fetch / Workers
      // types structurally require. Stays visible as a warning.
      "effect/casting-awareness": "warn",
      // Hard-codes abbreviations (`Arr`, `P`, `R`, …) with no options, so it is
      // unsatisfiable under the full-name convention (`import * as Option from
      // "effect/Option"`) this family shares with its consumers.
      "effect/prefer-namespace-imports": "off",

      // ---- Effect preset: ported-code allowances ---------------------------
      // The modules under packages/*/src are ports of behaviour the
      // applications carry today, which predates the Effect oxlint preset. The
      // rules below sit at `warn` so a port stays committable while each site
      // stays reported; a new site is a defect, not headroom. Once a rule's
      // count reaches zero its line is deleted, so it is back at the preset's
      // `error` (effect-web#48).
      "effect/imperative-loops": "warn",
      "effect/avoid-native-object-helpers": "warn",
      "effect/avoid-non-null-assertion": "warn",
      "effect/avoid-untagged-errors": "warn",
      "effect/avoid-direct-json": "warn",
      "effect/effect-run-in-body": "warn",
      "effect/avoid-direct-tag-checks": "warn",
      "effect/avoid-option-getorthrow": "warn",
      // ---- Effect preset: this repo's adoption allowances ------------------
      // Same shape as the block above, for the rules that first ran here when
      // this repo moved onto the Vite+ toolchain (#58): every pre-existing site
      // stays reported as a warning, a new site is a defect, and each line is
      // deleted once its count reaches zero (#98 tracks the burn-down).
      "effect/prefer-arr-match": "warn",
      "effect/no-length-comparison": "warn",
      "effect/prefer-arr-sort": "warn",
      "effect/prefer-match-over-switch": "warn",
      "effect/yield-in-for-loop": "warn",
      // ---- Effect preset: rules this workspace's conventions cut across ----
      // `prefer-option-over-null` also fires on `?: T | undefined`, which is
      // the ONLY spelling of an optional member `exactOptionalPropertyTypes`
      // lets a caller forward an optional of its own into (AGENTS.md). A bare
      // `null` / `undefined` in a return type is still a finding to read; the
      // options-object members are not.
      "effect/prefer-option-over-null": "warn",
      // `unknown` is the honest type at the two boundaries these libraries
      // sit on: a caught failure handed to an error tracker or a log line
      // (`describeError`, `describeSessionDegraded`), and the free-form
      // fields of a structured log event. Parsing them would change the
      // applications' log shape.
      "effect/no-unknown-parameters": "warn",
      "effect/no-unsafe-dictionary-type": "warn",
      "effect/no-runtime-typeof": "warn",
      // Every `{}` type here is the `(string & {})` half of a model-id
      // parameter (`Model | (string & {})`): it keeps the known ids in
      // autocomplete while accepting any string, the spelling upstream
      // `@effect/ai-anthropic` uses for the same parameter. The rule's
      // suggested `Record<string, never>` is not assignable from a string, so
      // it has no satisfiable fix for that idiom (#98).
      "effect/avoid-object-type": "off",
      "typescript/no-explicit-any": "off",
      "typescript/no-empty-object-type": "off",
      "typescript/ban-ts-comment": "off",
      "unicorn/no-empty-file": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      // Build/test configs are evaluated by Vite and Vitest in bare Node,
      // before any Effect runtime exists — there is no `Config` provider to
      // read from and no `FileSystem` service to call, so `process.env` and
      // `node:*` are the only things that work there. The Effect preset's
      // service rules have no satisfiable fix in these files. The same holds
      // for this repo's other plain-Node files: the `effect-evals` bin
      // launcher and its module-resolution hook (`loader.mjs`), which run
      // before the CLI's Effect runtime exists, and the loader test fixtures
      // that stand in for a consumer's plain modules.
      {
        files: [
          "**/vite.config.ts",
          "**/vitest.config.ts",
          "vite.package.ts",
          "scripts/**",
          "packages/effect-evals/bin/**",
          "packages/effect-evals/src/cli/loader.mjs",
          "packages/effect-evals/tests/fixtures/loader/**",
        ],
        rules: {
          "effect/avoid-node-imports": "off",
          "effect/avoid-sync-fs": "off",
          "effect/avoid-process-env": "off",
          // Plain Node build tooling (the task-graph builder, the dist guard):
          // native loops, `.length` and `Object.fromEntries` are the idiom.
          "effect/imperative-loops": "off",
          "effect/no-length-comparison": "off",
          "effect/prefer-arr-match": "off",
          "effect/avoid-native-object-helpers": "off",
          "effect/use-console-service": "off",
          "effect/use-filesystem-service": "off",
          "effect/use-path-service": "off",
          "effect/avoid-native-fetch": "off",
          "effect/effect-promise-vs-trypromise": "off",
          // Plain Node again: `child_process` / `os` / `try`-`catch` / a native
          // `.sort()` are what is available without an Effect runtime, and
          // `makeDistResolve` is a hook factory, not an Effect service.
          "effect/use-command-executor-service": "off",
          "effect/use-temp-file-scoped": "off",
          "effect/avoid-try-catch": "off",
          "effect/prefer-arr-sort": "off",
          "effect/no-service-constructor-imports": "off",
          // `...(process.env.X ? { x } : {})` is how a vitest option is left
          // unset under `exactOptionalPropertyTypes`.
          "effect/no-conditional-empty-object-spread": "off",
        },
      },
      // The bin and loader tests spawn the real plain-Node launcher and
      // resolution hook as a child `node` with the bin's own flags, in a
      // scratch package they lay out on disk: what they assert is Node's own
      // process behaviour (argv, stderr warnings), which only the Node APIs
      // reproduce. They sit at the same boundary as the plain-Node override
      // above (#98).
      {
        files: [
          "packages/effect-evals/tests/cli/bin.test.ts",
          "packages/effect-evals/tests/cli/loader.test.ts",
        ],
        rules: {
          "effect/avoid-node-imports": "off",
          "effect/avoid-sync-fs": "off",
          "effect/use-command-executor-service": "off",
          "effect/use-filesystem-service": "off",
          "effect/use-path-service": "off",
          "effect/use-temp-file-scoped": "off",
        },
      },
      // `cli/Discover` globs with Node's `fs.promises.glob`: effect's
      // `FileSystem` has no glob (its paths go through the `Path` service).
      {
        files: ["packages/effect-evals/src/cli/Discover.ts"],
        rules: {
          "effect/use-filesystem-service": "off",
        },
      },
      // Type-level tests: the expect-error directives ARE the assertions
      // (a statement that must fail to compile), and every binding exists to
      // be asserted against, never to be read.
      {
        files: ["**/tests/**/*.types.ts"],
        rules: {
          "eslint/no-unused-vars": "off",
          "effect/avoid-ts-ignore": "off",
        },
      },
      // Test fixtures are the seams under test, not domain code: a
      // wall-clock `Date` standing in for a publication stamp, a `CI`
      // variable toggled to drive a reporter, a stub that implements only
      // the slice of a platform interface (the Workers `Ai` binding) the code
      // under test calls, or an input that breaks its type on purpose to
      // reach a failure path (`as unknown as T`, #98). Each stays visible as
      // a warning, because a fixture cannot be written another way.
      {
        files: ["**/tests/**/*.ts"],
        rules: {
          "effect/avoid-any": "warn",
          "effect/no-chained-type-assertions": "warn",
          "effect/require-safety-comment-for-type-assertion": "warn",
          "effect/use-clock-service": "warn",
          "effect/avoid-process-env": "warn",
          "effect/require-effect-concurrency": "warn",
        },
      },
    ],
    // Type-aware linting is intentionally disabled: type checking stays the
    // `check` tasks' job (native tsc, Effect-patched).
    options: {
      typeAware: false,
      typeCheck: false,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  run: {
    tasks: {
      // The CI typecheck gate, as one task: every package's `check` (`tsc -p
      // tsconfig.json`). A pure graph node. The packages are named explicitly
      // — a `from: "dependencies"` edge does not traverse the workspace root's
      // own devDependencies — so a new package adds itself to EVERY list here
      // (`check`, `check:dist`, and `coverageFloors` above).
      check: {
        command: "echo 'check: every type gate green'",
        dependsOn: [
          "@thomasfosterau/effect-ai-cohere#check",
          "@thomasfosterau/effect-ai-elevenlabs#check",
          "@thomasfosterau/effect-ai-ext#check",
          "@thomasfosterau/effect-ai-gateway#check",
          "@thomasfosterau/effect-ai-mistral#check",
          "@thomasfosterau/effect-ai-voyage#check",
          "@thomasfosterau/effect-evals#check",
        ],
        cache: false,
      },
      // Dist-level import check (scripts/check-dist.mjs, #32): imports every
      // built entry and subpath under Node ESM, fails on a value export the
      // bundled `.d.ts` declares but the bundle lacks, and launches the
      // `effect-evals` bin from a packed tarball under `node_modules` (#42).
      // Reads `dist/`, hence the build edges.
      "check:dist": {
        command: "node scripts/check-dist.mjs",
        dependsOn: [
          "@thomasfosterau/effect-ai-cohere#build",
          "@thomasfosterau/effect-ai-elevenlabs#build",
          "@thomasfosterau/effect-ai-ext#build",
          "@thomasfosterau/effect-ai-gateway#build",
          "@thomasfosterau/effect-ai-mistral#build",
          "@thomasfosterau/effect-ai-voyage#build",
          "@thomasfosterau/effect-evals#build",
        ],
        cache: false,
      },
      // Every package's unit suite under one Istanbul coverage map
      // (`coverage/coverage-final.json`), which `fallow audit` reads for exact
      // per-function CRAP scores (`health.coverage` in .fallowrc.json).
      // Without it fallow estimates every function as uncovered, and any
      // function with cyclomatic complexity ≥ 5 fails the gate on its own.
      // Run this before `fallow audit` (the Claude Code PreToolUse fallow gate
      // runs the audit on `git commit` / `git push` but never refreshes this
      // map). Packages resolve each other through their development `exports`
      // (`src/`), so no build edge is needed.
      "test:coverage": {
        command: "vp test run --coverage",
        cache: false,
      },
    },
  },
  test: {
    // One entry per package: each package's own vite.config.ts is a vitest
    // project, so the root run and the root coverage map cover them all.
    projects: ["packages/*/vite.config.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts", "packages/effect-evals/src/cli/main.ts"],
      // Per package, not global: a glob's numbers aggregate only the files it
      // matches, so one package's surplus never hides another's drop.
      thresholds: Object.fromEntries(
        Object.entries(coverageFloors).map(([dir, floor]) => [
          `packages/${dir}/src/**`,
          { ...resolveCoverageThresholds(floor) },
        ]),
      ),
    },
  },
});
