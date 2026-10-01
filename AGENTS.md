# AGENTS.md

`CLAUDE.md` is a symlink to this file. This repo publishes the `@thomasfosterau/effect-ai-*` family and `effect-evals`: purely additive extensions to Effect's AI module (`effect/ai`), consumed by the owner's applications.

**Toolchain differs from the sibling libraries:** plain `pnpm run <script>` (no Vite+ `vp`), no format or lint gate (no Oxfmt, Oxlint or fallow), tsup instead of `vp pack`, and tests import from `vitest` (the siblings use `vite-plus/test`).

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
- **`@effect/tsgo`, `@typescript/native` and `typescript` bump together.** `@effect/tsgo` ships artifacts for an explicit set of TypeScript versions and fails `pnpm install` with `UnsupportedTargetPackageVersionError` on any other. Read the comment on the `@effect/tsgo` catalog entry before bumping any of them.
- **Strict catalog.** Every external version lives in `pnpm-workspace.yaml` (`catalogMode: strict`); manifests carry `catalog:`, `catalog:peers` or `workspace:*`. One exception: the gateway's optional `@cloudflare/workers-types` peer is the literal range `>=4`. After editing the catalog, run `pnpm install` and commit `pnpm-lock.yaml`, or every CI job fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
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
- **Barrels re-export each module as a namespace** (`export * as MistralClient from "./MistralClient"`), with an `@module` doc comment in the style of `effect/ai`. The gateway's barrel is flat; its `src/index.ts` says why `RerankerModel` is re-exported from `effect-ai-ext` directly.
- **Builds:** tsup (esbuild ESM + rollup-plugin-dts on TS6, `ignoreDeprecations: "6.0"`). `effect-ai-ext` builds one entry per module (its subpath exports); the others build `src/index.ts` only. `effect`, `@effect/*`, `@thomasfosterau/*` (and `@cloudflare/*` for the gateway) stay external so consumers share one copy. Packages develop with `exports` → `./src/index.ts`; `publishConfig` rewrites `exports` / `main` / `types` to `dist` on publish.
- **TypeScript 6/7 split:** `@typescript/native` (TS7, bin `tsc`, patched by `@effect/tsgo` so it also reports Effect diagnostics) runs `pnpm run check`; `typescript` (aliased to `@typescript/typescript6`, bin `tsc6`) is the JS-API compiler the language service and tsup's declaration bundler load. Effect `suggestion` diagnostics don't fail `tsc`; `warning` and `error` do.
- **Tests:**
  - No live-key or live-network tests: stub at `FetchHttpClient.Fetch` (capture the request, return a canned `Response` or SSE stream) or at the abstraction's `make` seam.
  - Effect helpers live per package in `tests/helpers/effect.ts` (`runTest`, `runTestExit`, `expectFailureInstanceOf`, `recordingTracer`); import from `vitest` and provide layers per test with `Effect.provide`.
  - Streaming providers also prove backpressure (a chunked stub, no unbounded buffering) and interruption (interrupting the Effect cancels the in-flight HTTP stream).
- **No live credentials, tokens or secrets** in code or fixtures.

## Commands

- `pnpm install` — dependencies (pnpm 11, pinned by `packageManager`); its `prepare` script runs `effect-tsgo patch --typescript`, which patches the native `tsc` and skips a binary that is already patched.
- `pnpm run check` — the type gate: native TS7 `tsc -p tsconfig.json` per package.
- `pnpm run test` — every package's `vitest run`. `pnpm run test:coverage` adds coverage.
- `pnpm run build` — tsup → each package's `dist/`.
- `pnpm run check:dist` — after `build`: imports every built entry and subpath under Node ESM and fails if a value export the bundled `.d.ts` declares is missing at runtime, which the src-resolving vitest suites cannot see.
- `pnpm run ci` — `check`, `test`, `build`, `check:dist` in order.

None of these needs a credential.

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran. There is no pre-push hook.

1. `pnpm run check`
2. `pnpm run test`
3. `pnpm run build`
4. `pnpm run check:dist`

`pnpm run ci` runs all four. For CI parity, start from a clean tree: `rm -rf node_modules packages/*/node_modules packages/*/dist && pnpm install --frozen-lockfile`.

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

The SessionStart hook (`.claude/hooks/session-start.sh`, registered in `.claude/settings.json`) runs `pnpm install --frozen-lockfile` (through Corepack when available), which also applies the tsgo patch, so the four gates run without manual setup. It hydrates no secrets, and nothing here needs one. Every gate runs in an agent session; `pnpm dlx effect-solutions` needs network.

## Documentation surfaces

- `README.md` (root): landing page with the package table.
- `packages/*/README.md`: the API reference consumers read on npm.
- `PUBLISHING.md`: the release pipeline and the owner's one-time setup.
- This file: agent guidance. Decisions go in issue comments.
