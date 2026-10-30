# Contributing

Maintained by Thomas Foster, with a workflow meant to be approachable for both humans and coding agents. Conventions, pitfalls and the full gate list are in [AGENTS.md](AGENTS.md).

## Setup

You need Node 22.18 or later and pnpm 11 (pinned by `packageManager`; `corepack enable` picks it up).

```sh
pnpm install
```

The install also runs the root `prepare` step: `vp config` installs the Vite+ git hooks, and `effect-tsgo patch --typescript --oxlint` patches the native `tsc` and the `oxlint` that `vite-plus` carries so they report Effect diagnostics. Every task then runs through `vp` (`node_modules/.bin/vp`; `pnpm exec vp` works if it isn't on your PATH).

## Branches

Branch off `trunk`, rebase rather than merge, squash-merge with a conventional prefix: see [AGENTS.md](AGENTS.md#branches-and-pull-requests).

## Git hooks

Hooks are managed by Vite+; the editable [.vite-hooks/pre-commit](.vite-hooks/pre-commit) is committed. **pre-commit** runs `vp staged` (format + lint on staged files). There is no pre-push hook: run the gates yourself.

## CI expectations

[ci.yml](.github/workflows/ci.yml) runs the `ci` job, whose steps are the gate list in [AGENTS.md](AGENTS.md#verification), and a `node-floor` job that reruns the unit suites, build and dist check on Node 22.18.0. [release.yml](.github/workflows/release.yml) runs changesets/action on `trunk`: it opens the version PR while unreleased changesets exist and publishes once it merges, via npm OIDC trusted publishing (see [PUBLISHING.md](PUBLISHING.md)). Both workflows are hardened for Dependabot PRs: no default token permissions (each job grants only what it needs, and only the release job holds `id-token: write`), every action pinned to a commit SHA, `persist-credentials: false` on checkouts that never push, `pnpm install --frozen-lockfile`, no secrets in any job a pull request can trigger, Node pinned to the latest release rather than setup-node's `latest` (which resolves to a Node pre-release), and `uvx zizmor --offline .github` clean.

## Pre-PR checklist

1. The gates in [AGENTS.md](AGENTS.md#verification), each with its final pass/fail.
2. A changeset (`pnpm changeset`) where [AGENTS.md](AGENTS.md#branches-and-pull-requests) requires one.
3. `git fetch origin trunk && git rebase origin/trunk`
4. Docs: the package `README.md` for any exported change; the package `CLAUDE.md` for a new term or invariant.

## Running individual checks

```sh
vp check                                           # format + lint (Oxfmt + Oxlint)
vp check --fix                                     # apply the fixes
vp run check                                       # the whole type gate
vp run --filter ./packages/effect-ai-mistral check # one package's type gate
vp run -r test:unit                                # unit tests
vp test run tests/some.test.ts                     # one file (from inside the package)
vp run -r test:coverage                            # the per-package coverage floors
vp run -r build                                    # emit dist/
vp run check:dist                                  # built entries load and type-check
vp run docgen                                      # run every @example, write the API reference
fallow audit                                       # dead code, duplication, complexity (needs vp run test:coverage first)
```
