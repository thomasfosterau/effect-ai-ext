# Publishing

Versions and changelogs are managed by [Changesets](https://github.com/changesets/changesets); publishing is npm trusted publishing (OIDC) from the protected `release` environment. There is no `NPM_TOKEN`.

## Release flow

1. A PR that changes a published package's behaviour adds a changeset (`pnpm changeset`) and merges into `trunk`.
2. The `Release` workflow (`.github/workflows/release.yml`) runs on every push to `trunk`. While changesets are pending, it opens or updates the version PR (`chore: version packages`), which bumps versions and writes each `CHANGELOG.md`.
3. The owner merges the version PR. The next `Release` run publishes every bumped package with `changeset publish`, which runs `pnpm publish`; pnpm 11 performs the trusted-publishing (OIDC) exchange itself.
4. With no pending changesets, any package whose version is not yet on npm is published; packages already on the registry are skipped, so a no-op run is green.

Never publish or version by hand. A local `changeset publish` has no credentials and fails: the release job's GitHub OIDC token (`id-token: write`) is exchanged with npm for short-lived publish credentials, and only that job can mint one.

**Provenance:** nothing requests it. npm attaches provenance under trusted publishing only for a public repository, and this one is private. Never add `--provenance` or `NPM_CONFIG_PROVENANCE=true`: an explicit provenance request from a private repository fails the publish.

## One-time owner setup

1. On npmjs.com, for each package: Settings → Trusted Publisher → GitHub Actions, repository `thomasfosterau/effect-ai-ext`, workflow `release.yml`, environment `release`. Until this is done for a package, its publish step fails auth.
2. In the repository settings, Environments → `release`: add required reviewers to make every release a manually approved one. GitHub creates the environment on first use.
3. Settings → Actions → General: allow GitHub Actions to create and approve pull requests, or the version PR cannot be opened.

The release job also installs a global `npm@11`, pinned to a major version (never `@latest`) because the job holds `id-token: write`; the publish path itself runs through pnpm and does not depend on it.
