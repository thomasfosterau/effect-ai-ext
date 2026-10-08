# AGENTS.md

`CLAUDE.md` is a symlink to this file. This repo publishes the `@thomasfosterau/effect-ai-*` family and `effect-evals`: purely additive extensions to Effect's AI module (`effect/ai`), consumed by the owner's applications.

**Toolchain:** the Vite+ library standard the sibling libraries share, copied from effect-web (#58): `vp` runs every task, `vp check` is the format (Oxfmt) and lint (Oxlint with the Effect preset) gate, `vp pack` (tsdown) builds, tests import from `vite-plus/test`, `docgen` compiles and runs every JSDoc `@example` against the built `dist/`, and the fallow gate runs before every agent commit and push.

| Package | Directory | Purpose · peers |
| --- | --- | --- |
| `@thomasfosterau/effect-ai-ext` | `packages/effect-ai-ext` | Provider-neutral abstractions upstream Effect lacks (reranker, classifier, TTS, STT, image, moderation, voice conversion), each written as if it could merge into `effect/ai`; one subpath export per module · `effect` |
| `@thomasfosterau/effect-ai-gateway` | `packages/effect-ai-gateway` | Routing layer: repoints _other_ providers' clients at a Cloudflare AI Gateway route (Worker binding or public HTTPS endpoint), BYOK; not itself a provider · `effect`, `@effect/ai-anthropic`, optional `@cloudflare/workers-types` |
| `@thomasfosterau/effect-ai-{mistral,cohere,voyage,elevenlabs}` | `packages/effect-ai-<vendor>` | First-party providers over each vendor's own API; portable, so a routing layer repoints them through `apiUrl` · `effect` |
| `@thomasfosterau/effect-evals` | `packages/effect-evals` | Effect-native LLM evaluation toolkit and the `effect-evals` CLI · `effect`, optional `@effect/platform-node` (CLI only) |

## Common pitfalls

- **Upstream boundary.** Write no local package for a provider the Effect org already ships (`@effect/ai-anthropic` today; OpenAI/Google if published); repoint the upstream package instead, as `effect-ai-gateway/src/Anthropic.ts` does.
- **`effect` is a singleton.** Two copies break `Context` / `Layer` / `Schema` identity, so every published package declares it as a peer (`catalog:peers`), takes it as a `catalog:` devDependency for building and testing, and `overrides: { effect: "catalog:" }` forces every resolution onto that one copy. `@effect/*` packages a published package needs are peers too, never exact-pinned dependencies: their own `effect` peer would reject a consumer's older rc.
- **The Effect line moves as one.** `effect`, `@effect/ai-anthropic`, `@effect/platform-node` and the transitive `@effect/platform-node-shared` share one exact rc in the default catalog. Bump `@effect/platform-node-shared` by hand: only the catalog and `overrides` name it, so Dependabot never proposes it.
- **The published peer floor is open, never an exact pin:** `catalog:peers` declares `effect: ">=4.0.0-rc.118"`, per the shared Effect-floor policy (effect-jsonapi#115). rc.118 is the first rc with the `effect/unstable/*` → `effect/*` path move (#51). Re-verify by pointing the default catalog at the floor before moving it; raising the floor is a breaking change for every package.
- **`@effect/tsgo`, `@typescript/native`, `typescript` and `vite-plus` bump together.** `@effect/tsgo` ships artifacts for an explicit set of TypeScript and Oxlint versions (`effect-tsgo patch --typescript --oxlint` patches both) and fails `pnpm install` with `UnsupportedTargetPackageVersionError` on any other; `vite-plus` pins the `oxlint`, `oxfmt` and `vitest` it carries, so `vite`, `vitest` and `@vitest/coverage-istanbul` follow it. Read the comments on the `@effect/tsgo` and `vite-plus` catalog entries before bumping any of them.
- **Strict catalog.** Every external version lives in `pnpm-workspace.yaml` (`catalogMode: strict`); manifests carry `catalog:`, `catalog:peers` or `workspace:*`. After editing the catalog, run `pnpm install` and commit `pnpm-lock.yaml`, or every CI job fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- **`minimumReleaseAge`** holds a newly published version for a day before `pnpm install` takes it (Dependabot's `cooldown` mirrors it); `@thomasfosterau/*` is exempt.
- **The `apiUrl` override is a contract, not a convenience:** it is how a routing layer (the gateway) repoints a provider's client for BYOK. Every provider has a test that points `apiUrl` at a stub server.
- **Errors leave a provider only as `AiError`.** No transport- or schema-level failure escapes a provider's public surface.
- **`effect-evals` type-checks more than `src`.** Every other package's `tsconfig.json` includes `src` only (tests are validated by running them); `effect-evals` also checks `tests` and its configs and sets `erasableSyntaxOnly`, because Node type-strips its TypeScript (see the comment in its `tsconfig.json`). Its relative imports carry `.ts`; the other packages' are extensionless.
- **Ported comments cite their evidence.** A bare `#NNN` or `docs/decisions/*.md` in a comment ported from an application names that application's tracker or docs (the website unless stated), not this repo. New comments cite this repo's issues as `#NNN` and others as `website#NNN`.

## Conventions

- **`exactOptionalPropertyTypes` is on:** spell an option a caller may forward `undefined` for as `?: T | undefined`.
- **A provider-neutral abstraction mirrors `effect/ai`'s `EmbeddingModel`:** a `Context.Service` tag, a `Service` interface, a `make(...)` that validates provider results, a typed `AiError` channel, `Effect.withSpan` telemetry and options/provider-options interfaces. The in-repo example is `effect-ai-ext/src/RerankerModel.ts`.
- **A first-party provider mirrors `effect-ai-mistral`:**
  - `<Vendor>Client`: a `Context.Service` over `HttpClient` with base-URL prefixing, an optional `Redacted` key, and a `make` / `layer` / `layerConfig` triad.
  - Per-capability models implementing the relevant `effect/ai` or `effect-ai-ext` service (`LanguageModel`, `EmbeddingModel`, `RerankerModel`, …).
  - Wire discipline: hand-written request interfaces (plain objects sent as JSON); lenient response decoding (`Schema.optional` + `Schema.NullOr`, free strings for enums the mapper narrows) so a new vendor field never fails an otherwise-valid response; `internal/errors.ts` maps `HttpClientError` / `SchemaError` to `AiError` through `AiError.reasonFromHttpStatus`.
- **Barrels re-export each module as a namespace** (`export * as MistralClient from "./MistralClient"`). The gateway's barrel is flat (`export *` of each module) and re-exports no `RerankerModel` name; consumers import it from `@thomasfosterau/effect-ai-ext/RerankerModel` (#97).
- **Doc comments put the description first, including module headers:** summary sentence, details, then tags (`@module`, `@copyright`, `@category`, …). Hovers show only the text before the first tag, so a header that opens with `@module` or `@copyright` shows no summary. Don't add `@since`: each `docgen.json` sets `enforceVersion: false`, so docgen never asks for it. Every `@example` is compiled and run (`vp run docgen`), so it must type-check and run offline: build layers and programs, but don't execute anything that calls a vendor API.
- **Builds:** `vp pack` (tsdown: rolldown ESM + rolldown-plugin-dts on TS6), configured once in `vite.package.ts` and instantiated by each package's one-call `vite.config.ts`. `effect-ai-ext` builds one entry per module (its subpath exports), each from a build-only facade under `packages/effect-ai-ext/entries/` (its `vite.config.ts` says why); `effect-evals` builds `src/index.ts` and its CLI (`dist/cli/main.js`); the others build `src/index.ts` only. `effect`, `@effect/*`, `@thomasfosterau/*`, `@cloudflare/*` and `node:*` stay external so consumers share one copy. Packages develop with `exports` → `./src/index.ts`; `publishConfig` rewrites `exports` / `main` / `types` to `dist` on publish, so tests and type checks resolve a sibling to its `src/` and no task needs a build first.
- **TypeScript 6/7 split:** `@typescript/native` (TS7, bin `tsc`, patched by `@effect/tsgo` so it also reports Effect diagnostics) runs `vp run check`; `typescript` (aliased to `@typescript/typescript6`, bin `tsc6`) is the JS-API compiler the language service and `vp pack`'s declaration bundler load. Only Effect `error` diagnostics fail `tsc`: `suggestion` never affects the exit code, and `tsconfig.base.json` sets `ignoreEffectWarningsInTscExitCode` so `warning` diagnostics stay visible but don't fail `vp run check` either, as in the sibling libraries (#67).
- **Format and lint:** `vp check` runs Oxfmt and Oxlint (config in the root `vite.config.ts`: `@effect/tsgo`'s `recommended` preset plus `@mpsuesser/oxlint-plugin-effect`, rule set copied from effect-web). Only `error` fails it. The rules listed under "adoption allowances" sit at `warn` because pre-existing code still trips them (#98 tracks the burn-down): a new site is a defect, not headroom, and a rule goes back to `error` once its count reaches zero. `CHANGELOG.md` files are never formatted (Changesets writes them).
- **Tests:**
  - No live-key or live-network tests: stub at `FetchHttpClient.Fetch` (capture the request, return a canned `Response` or SSE stream) or at the abstraction's `make` seam.
  - Effect helpers live per package in `tests/helpers/effect.ts` (`runTest`, `runTestExit`, `expectFailureInstanceOf`, `recordingTracer`); import from `vite-plus/test` (never `vitest`; the `vite-plus/prefer-vite-plus-imports` lint rule enforces it) and provide layers per test with `Effect.provide`.
  - Streaming providers also prove backpressure (a chunked stub, no unbounded buffering) and interruption (interrupting the Effect cancels the in-flight HTTP stream).
  - **Coverage is a ratchet (#100).** Each package's `vite.config.ts` exports a `coverageFloor` (lines / branches / functions / statements), set from its measured coverage rounded down to the integer; `vite.package.ts` holds the shared target, effect-web's 90 / 85 / 90 / 90, which a metric the floor omits falls back to. Both `vp run test:coverage` (root, per-package glob thresholds) and `vp run -r test:coverage` fail when a package drops below its floor. When a change raises a package's coverage, raise its floor in the same PR; never lower a floor or exclude files to get a change through, add the tests instead. A new package adds its floor to `coverageFloors` in the root `vite.config.ts`.
- **No live credentials, tokens or secrets** in code or fixtures.

## Commands

- `pnpm install` — dependencies (pnpm 11, pinned by `packageManager`) plus the Vite+ git hooks (`vp config`; pre-commit runs `vp staged`: format + lint on staged files) and the `prepare` step that patches the native `tsc` and the `oxlint` `vite-plus` carries with `@effect/tsgo` (`effect-tsgo patch --typescript --oxlint`, which skips a binary that is already patched). No pre-push hook: run the gates yourself.
- `vp check` — format + lint (Oxfmt + Oxlint). `vp check --fix` applies the fixes. `vp run check` — the type gate: native TS7 `tsc -p tsconfig.json` per package. They are different commands.
- `vp run -r test:unit` — every package's unit suite (node Vitest; nothing here needs a credential).
- `vp run -r build` — `vp pack` → every package's `dist/`.
- `vp run docgen` — builds every package, then type-checks and runs every JSDoc `@example` with `@effect/docgen` (`tsc` + `tsx`) against the built `dist/` (each `docgen.json` maps the package names onto `dist/` through `examplesCompilerOptions.paths`) and writes the git-ignored API reference to `packages/*/docs/`. CI runs it.
- `vp run check:dist` — builds every package, then imports every built entry and subpath under Node ESM and fails if a value export the bundled `.d.ts` declares is missing at runtime (which the src-resolving suites cannot see), and launches the `effect-evals` bin from a packed tarball under `node_modules`.
- `vp run test:coverage` — every package's unit suite under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for exact per-function CRAP scores (without the map fallow scores every function as uncovered); fails if any package's coverage drops below its `coverageFloor`. CI runs it.
- `pnpm audit --audit-level high` — the dependency audit CI runs (network).
- `pnpm changeset` — add a changeset.

Invoke everything through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations: `pnpm install` (and `pnpm install --frozen-lockfile` in CI; the Release job adds `--ignore-scripts`, see [PUBLISHING.md](PUBLISHING.md#release-job-hardening)), `pnpm audit`, `pnpm changeset` / `pnpm publish` on the release path. `vp` is `node_modules/.bin/vp`; the SessionStart hook puts it on PATH.

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran. There is no pre-push hook.

1. From a clean install, which is what CI sees: `rm -rf node_modules packages/*/node_modules packages/*/dist && pnpm install --frozen-lockfile`.
2. `vp check`
3. `vp run check`
4. `vp run -r test:unit`
5. `vp run test:coverage` (the coverage floors)
6. `vp run -r build`
7. `vp run check:dist`
8. `vp run docgen`
9. `pnpm audit --audit-level high` (network)
10. `fallow audit --format json --quiet --explain --gate-marker agent` (the fallow gate below; not a CI step), which reads the map step 5 wrote. The verdict must not be `fail`.

Steps 2–9 are CI's `ci` job, in its order ([ci.yml](.github/workflows/ci.yml)); its `node-floor` job reruns 4, 6 and 7 on Node 22.18.0.

## Branches and pull requests

- **Branch off `trunk`; PR against `trunk`; squash-merge.** `trunk` is the default branch; there is no `main`. Name branches `issue-<n>-<slug>`, one branch and PR per issue. Rebase onto `origin/trunk` before opening or updating a PR; never merge `trunk` into your branch (GitHub's Update-branch button merges).
- **Changesets.** Every change to a published package's behaviour carries a changeset (`pnpm changeset`); docs-, CI- and tooling-only changes need none. TSDoc ships in the published `.d.ts`, so a doc-comment change gets a `patch`. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it. The pipeline and the owner's one-time setup are in [PUBLISHING.md](PUBLISHING.md).
- **Standing PR approvals:** once a branch has a pushed commit, open its PR without waiting to be asked; watch it to merge or close, investigating CI failures and review comments as they arrive and rebasing when it goes conflicting; keep the PR body current with what shipped against the issue's spec.
- **GitHub scope.** GitHub writes go to `thomasfosterau/effect-ai-ext` only; pass `-R thomasfosterau/effect-ai-ext` whenever the cwd might be another checkout. Read other repos (the consuming applications included) for reference only. Use the `gh` CLI for GitHub operations, even when GitHub MCP tools are available.

## Work tracker

Issues are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. The issue is the spec — read its comments; later comments override the body. Issues are snapshots, so re-verify their claims against current `trunk` before editing. Record decisions and findings as issue comments. Stop-and-report is a valid outcome: on a blocker outside the issue's scope (an upstream `effect/ai` gap, a design conflict with `effect-ai-ext`'s interfaces), comment the evidence on the issue and stop. Scope cut mid-PR becomes a linked issue before merge.

## Effect

Consult effect-solutions before writing Effect code; never guess at an Effect pattern. It is not a dependency here and the SessionStart hook doesn't install it, so run it through `pnpm dlx effect-solutions list`, then `pnpm dlx effect-solutions show <topic>…` (needs network). When the guides run out, or offline, read the Effect source each package installs: `packages/<pkg>/node_modules/effect/src`. The pinned version is the `effect` entry in `pnpm-workspace.yaml`; at that rc the schema-backed error is `Schema.TaggedError<Self>()(tag, fields)` (`Schema.TaggedErrorClass` was the beta-line name).

## Agent sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`, registered in `.claude/settings.json`) runs `pnpm install --frozen-lockfile` (through Corepack when available), which also applies the tsgo patch, and puts `vp` (a re-exec shim that prefers the nearest checkout's `node_modules`) and `fallow` on PATH for non-interactive shells, so the gates run without manual setup. It hydrates no secrets, and nothing here needs one.
- A PreToolUse hook (`.claude/hooks/fallow-gate.sh`) blocks `git commit` / `git push` when `fallow audit --base origin/trunk` fails; it reads the coverage map on disk, so run `vp run test:coverage` first. A PostToolUse hook runs `vp fmt` on every source, JSON, CSS or Markdown file you write or edit.
- Every gate in [Verification](#verification) runs in an agent session; `pnpm audit` and `pnpm dlx effect-solutions` need network.

## Documentation surfaces

- `README.md` (root): landing page with the package table.
- `packages/*/README.md`: the API reference consumers read on npm.
- `PUBLISHING.md`: the release pipeline and the owner's one-time setup.
- This file: agent guidance. Decisions go in issue comments.

---

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking. Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict. The config is `.fallowrc.json`: a new published entry point joins its `entry` list, and a new package adds a boundary zone and rule.

## Fallow task map

| When the agent is about to... | Run |
| --- | --- |
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `fallow audit --base <ref>` |
| check which architecture rules apply to a file before changing it | `fallow guard <files>` |
| understand a finding | `fallow explain <issue-type>` |
