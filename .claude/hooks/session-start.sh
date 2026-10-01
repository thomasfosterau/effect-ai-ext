#!/usr/bin/env bash
#
# Provision a checkout for NON-INTERACTIVE use — the Claude Code SessionStart
# hook (`.claude/settings.json`), so an agent session can run the gates
# (`pnpm run check` / `test` / `build` / `check:dist`) without manual setup
# (issue #30). The same shape as the sibling library repos' hook, minus the
# Vite+ shims this repo has no use for.
#
# ## What it does
#
# One thing: `pnpm install --frozen-lockfile`. That is also what patches the
# native TypeScript compiler with @effect/tsgo — the root `prepare` script
# runs on every install — so after this hook `tsc` reports
# `+effect-tsgo.<version>` and `pnpm run check` emits Effect's own diagnostics
# exactly as CI does.
#
# Unconditional, not only when node_modules is absent: a prebaked container
# can carry a tree built from an OLDER lockfile, and stale dependencies
# masquerade as trunk breakage. A frozen install is a sub-second no-op when
# the tree is already in sync, and `effect-tsgo patch` skips a binary whose
# hash already matches its replacement.
#
# `packageManager` pins pnpm 11; the session image may ship an older pnpm, so
# the install goes through Corepack whenever it is available (it honours the
# pin) and falls back to the `pnpm` on PATH.
#
# ## Secrets
#
# This hook hydrates NO secrets. The suites are recorded/stubbed fixtures only
# (AGENTS.md → Conventions), so nothing here needs a credential.
#
# ## Contract
#
# Idempotent, and never fatal. Every failure path logs and continues, because
# the SessionStart hook must not block a session and a half-provisioned
# checkout is more useful than a session that refused to start. Callers that
# want hard failure should check the tools themselves afterwards.
#
# Untrusted-content note: this script reads only fixed, hardcoded paths. It
# takes no input from repo content, issue or PR bodies, or anything an agent
# could have been persuaded to write earlier in a session. Do not add such
# input without revisiting this note — it runs on every session start.

set -uo pipefail

log() { printf '[session-start] %s\n' "$1" >&2; }

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

if ! command -v node >/dev/null 2>&1; then
  log "node not found; nothing to provision"
  exit 0
fi

# Resolve a pnpm that satisfies `packageManager`. Corepack ships with Node and
# reads the pin itself; fall back to whatever `pnpm` is on PATH.
PNPM="pnpm"
if command -v corepack >/dev/null 2>&1; then
  if (cd "$PROJECT_DIR" && corepack pnpm --version >/dev/null 2>&1); then
    PNPM="corepack pnpm"
  fi
fi
if ! (cd "$PROJECT_DIR" && $PNPM --version >/dev/null 2>&1); then
  log "no usable pnpm found; run \`corepack enable\` or install pnpm 11, then \`pnpm install\`"
  exit 0
fi

if [ -f "$PROJECT_DIR/pnpm-lock.yaml" ]; then
  log "syncing dependencies against the lockfile ($($PNPM --version 2>/dev/null))…"
  # CI=true: pnpm otherwise stops for a TTY confirmation before rebuilding a
  # modules directory that an older pnpm or different settings produced.
  if (cd "$PROJECT_DIR" && CI=true $PNPM install --frozen-lockfile >/dev/null 2>&1); then
    log "dependencies in sync; native tsc: $("$PROJECT_DIR/node_modules/.bin/tsc" --version 2>/dev/null || echo unavailable)"
  else
    log "dependency install failed; run \`pnpm install\` by hand and check the output"
  fi
fi

exit 0
