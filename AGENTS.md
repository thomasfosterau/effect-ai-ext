# AGENTS.md

Always-on context for coding agents working in this repo. Keep it tight.

## What this repo is

The long-term home of the **`@thomasfosterau/effect-ai-*`** package family —
idiomatic, purely-additive extensions to Effect's AI packages
(`effect/unstable/ai`). Each package is published to npm under the
`@thomasfosterau/` scope.

Two kinds of package live here:

- **Routing layers** — `effect-ai-gateway` is specifically Cloudflare's AI
  Gateway product (BYOK, binding-routed). It repoints _other_ providers'
  clients at a gateway route; it is not itself a first-party provider.
- **First-party providers** — `effect-ai-mistral`, `effect-ai-cohere`,
  `effect-ai-voyage`, `effect-ai-elevenlabs`. Each speaks a vendor's own API
  and is portable; a routing layer (the gateway, or an OpenRouter package one
  day) repoints its client via the `apiUrl` override.

Plus **`effect-ai-ext`** — provider-neutral service _abstractions_ upstream
Effect lacks (reranker, classifier, TTS, STT, image, moderation, voice
conversion), each written as if it could merge into `effect/unstable/ai`.

**Upstream boundary:** we do **not** write local packages for providers the
Effect org already covers (`@effect/ai-anthropic` today; OpenAI/Google
if/when published) — repoint the upstream package instead (see
`effect-ai-gateway/src/Anthropic.ts`).

## Toolchain

Node + pnpm. Everything runs through pnpm workspace scripts.

- **Install:** `pnpm install`. This also runs `prepare`
  (`scripts/patch-native-tsc.sh`), which patches the native TypeScript
  compiler with `@effect/tsgo`.
- **Type-check:** `pnpm run check` → per package `tsc -p tsconfig.json`.
- **Test:** `pnpm run test` → per package `vitest run`.
- **Build:** `pnpm run build` → per package `tsup` (publishable `dist/`).
- **All three:** `pnpm run ci`.

### TypeScript 6/7 side-by-side split

Two TypeScripts, each with a job (both proven against `effect@4` beta):

- **`@typescript/native`** (real `typescript@7`) → the fast native `tsc` used
  for `pnpm run check`. The `prepare` step patches it with `@effect/tsgo` so
  it also emits Effect's language-service diagnostics (bin: `tsc`).
- **`typescript`** (aliased to `@typescript/typescript6@6`) → the TS6 JS-API
  compiler that `@effect/language-service` (editor LSP) and tsup's declaration
  bundler need (bin: `tsc6`).

Type-checking covers **`src` only** (`tsconfig.json` `include: ["src"]`), matching
the packages' origin repo. Test files are validated by executing them under
vitest, not by `tsc`. `effect-language-service` `suggestion`-level diagnostics
do not fail `tsc`; `warning`/`error` do.

### Build (publishing)

Each package builds with `tsup`: esbuild bundles the single-barrel
`src/index.ts` to one Node-ESM `dist/index.js`, and rollup-plugin-dts (on the
TS6 JS-API compiler, with `ignoreDeprecations: "6.0"`) bundles `dist/index.d.ts`.
`effect` / `@effect/*` (and `@cloudflare/*` for the gateway) stay **external**
so published packages share the consumer's singleton copies.

Packages develop with `exports` → `./src/index.ts` (zero-build workspace
consumption); `publishConfig` rewrites `exports`/`main`/`types` → `dist` on
publish.

### Versioning & releases (Changesets)

Versions and changelogs are managed by [Changesets](https://github.com/changesets/changesets).

- **Every PR that changes an already-published package includes a changeset:**
  run `pnpm changeset`, pick the packages and the semver bump
  (patch/minor/major), and describe the change. The generated `.changeset/*.md`
  file is committed with the PR. (Pure-infra PRs that touch no published package
  need none.)
- **A package's first release takes its version straight from `package.json`**
  (all start at `0.1.0`) — no changeset for the pre-first-publish state, since
  `changeset publish` ships any version not yet on the registry. Changesets
  begin once a package has a published version to bump from.
- **Releasing is automated.** The `Release` workflow (`.github/workflows/release.yml`)
  watches `main`: it opens/updates a **"Version Packages"** PR that applies the
  pending changesets (bumping versions, writing `CHANGELOG.md`); merging that PR
  publishes the bumped packages. With no pending changesets, any package whose
  version isn't yet on npm is published (packages already on the registry are
  skipped, so a no-op run is green).
- **Publishing is tokenless (npm Trusted Publishing).** The workflow publishes
  via GitHub OIDC (`id-token: write`) — no `NPM_TOKEN` — and provenance is
  emitted automatically. This needs npm ≥ 11.5.1 (the workflow upgrades it) and
  a **Trusted Publisher** configured on npmjs.com for each package, pointing at
  `thomasfosterau/effect-ai-ext` + `release.yml`. Never publish by hand:
  provenance requires the CI OIDC provider, so a local `changeset publish`
  fails.

## Dependency conventions

- **`catalog:` for every external dependency** (see `pnpm-workspace.yaml`).
  Package manifests reference `catalog:` (dev/test deps) or a concrete range
  (peers). `effect` **must** be a singleton — two copies break
  Context / Layer / Schema identity — so it is a **peerDependency** on every
  published package, plus a `catalog:` devDependency for building/testing.
- Internal deps use `workspace:*`. pnpm rewrites `catalog:`/`workspace:` to
  concrete ranges on publish.
- After editing the catalog, run `pnpm install` and commit the regenerated
  `pnpm-lock.yaml`.

## Package conventions (the archetypes)

Every package mirrors an existing model. Read the reference before writing:

- **A provider-neutral abstraction** mirrors `effect/unstable/ai`'s
  `EmbeddingModel`: a `Context.Service` tag + `Service` interface + a
  `make(...)` that validates provider results + a typed `AiError` channel +
  `Effect.withSpan`/Telemetry + options/provider-options interfaces.
  `effect-ai-gateway/src/RerankerModel.ts` is the in-repo example.
- **A first-party provider** mirrors `effect-ai-mistral`:
  - **`<Vendor>Client`** — a `Context.Service` over `HttpClient` with base-URL
    prefixing, an optional `Redacted` key, and a `make` / `layer` /
    `layerConfig` triad. The **`apiUrl` override is a contract, not a
    convenience** — it is how a routing layer (the gateway) repoints the
    client for BYOK. Every provider gets a test that points `apiUrl` at a stub
    server.
  - **Per-capability models** implementing the relevant `effect/unstable/ai`
    or `effect-ai-ext` service (`LanguageModel`, `EmbeddingModel`,
    `RerankerModel`, …).
  - **Wire discipline:** hand-written request interfaces (plain objects sent
    as JSON); **lenient** Schema decode for responses (`Schema.optional` +
    `Schema.NullOr`, free strings for enums the mapper narrows) so a new
    vendor field never fails an otherwise-valid response;
    `internal/errors.ts` mapping `HttpClientError` / `SchemaError` → `AiError`
    via `AiError.reasonFromHttpStatus`.
- **Errors exclusively through `AiError`** — no transport- or schema-level
  failures escape a provider's public surface.
- **Single-barrel `src/index.ts`** re-exporting each module as a namespace
  (`export * as MistralClient from "./MistralClient"`), naming/doc style
  matching `effect/unstable/ai` (`@module`, JSDoc).

## Testing

- **No live-key or live-network tests in CI** — recorded/stubbed fixtures
  only. Stub at `FetchHttpClient.Fetch` (capture the outgoing request, return
  a canned `Response`/SSE) or at the abstraction's `make` seam.
- Effect test helpers live per package under `tests/helpers/` (`runTest`,
  `runTestExit`, `expectFailureInstanceOf`, `recordingTracer`). Import from
  `vitest` directly; provide layers per test with `Effect.provide`.
- Streaming providers additionally prove backpressure (a chunked stub, no
  unbounded buffering) and interruption (aborting the Effect cancels the
  in-flight HTTP stream).

## GitHub / work conventions

- **Writes are scoped to `thomasfosterau/effect-ai-ext` only.** Never create
  or edit issues, PRs, comments, or releases in any other repo — the
  `thomasfosterau/website` source repo included — without explicit owner
  approval. Read other repos read-only for reference.
- One branch + PR per issue: `issue-<n>-<slug>`, PR against `main`,
  squash-merge. Keep the PR body current with what shipped vs the issue's spec.
- **The issue is the spec — read all of it, comments included.** Issues are
  snapshots; re-verify against current `main` before editing.
- **Stop-and-report is a valid outcome.** On a blocker outside the issue's
  scope (an upstream `effect/unstable/ai` gap, a design conflict with
  `effect-ai-ext`'s interfaces), comment the evidence on the issue and stop —
  don't improvise placements or workarounds the owner never approved.
- No live credentials, tokens, or secrets in code or fixtures.
