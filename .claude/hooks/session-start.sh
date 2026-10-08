#!/usr/bin/env bash
#
# Provision a checkout for NON-INTERACTIVE use — the Claude Code SessionStart
# hook (`.claude/settings.json`), so an agent session can run the gates
# (`vp check`, `vp run check`, `vp run -r test:unit`, `vp run -r build`,
# `vp run check:dist`) without manual setup (issue #30). The same shape as the
# sibling library repos' hook (effect-web's, #58).
#
# ## What it does
#
# 1. `pnpm install --frozen-lockfile`. That is also what patches the native
#    TypeScript compiler and the `oxlint` that `vite-plus` carries with
#    @effect/tsgo, and installs the Vite+ git hooks (`vp config`) — the root
#    `prepare` script runs on every install — so after this hook `tsc` reports
#    `+effect-tsgo.<version>` and `vp run check` emits Effect's own diagnostics
#    exactly as CI does.
# 2. Puts `vp` and `fallow` on PATH for non-interactive shells. Both live only
#    in `node_modules/.bin`, which is on nobody's PATH, yet the documented
#    workflows invoke `vp …` directly and the PreToolUse fallow gate
#    (`.claude/hooks/fallow-gate.sh`) runs `fallow` before every agent
#    `git commit` / `git push`. They are linked into `~/.local/bin`, a
#    directory already on PATH in the session image and writable by the
#    session user: a symlink survives where an `export` from this script
#    cannot. `vp` gets a re-exec shim rather than a symlink (see below).
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
LOCAL_BIN="${HOME:-/root}/.local/bin"

mkdir -p "$LOCAL_BIN" 2>/dev/null || log "cannot create $LOCAL_BIN; continuing"

# Link a binary into ~/.local/bin, replacing a stale link but never a real file.
link_tool() {
  src="$1"
  name="$(basename "$src")"
  dest="$LOCAL_BIN/$name"
  [ -x "$src" ] || return 0
  # Leave a real (non-symlink) binary alone: something deliberately installed it.
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    return 0
  fi
  ln -sfn "$src" "$dest" 2>/dev/null || log "could not link $name"
}

# `vp` gets a re-exec shim rather than a plain symlink (copied from effect-web,
# which took it from the gardeneria application, gardeneria #1663). A symlink
# always resolves to $PROJECT_DIR's node_modules/vite-plus, even when invoked
# with cwd inside another checkout — so the CLI process would load one tree's
# vitest while that checkout's test modules resolve its own copy, and two
# physical instances of the same vitest corrupt its suite-collector state. The
# shim walks up from $PWD for the nearest project-local vite-plus and re-execs
# that, falling back to the primary checkout's when none is found above cwd.
VP_SHIM_MARKER="# generated-by: .claude/hooks/session-start.sh (vp re-exec shim, gardeneria issue #1663)"
write_vp_shim() {
  dest="$LOCAL_BIN/vp"
  # Leave a real, non-generated file alone: something deliberately installed
  # it. A stale symlink or a shim generated earlier is fair game to regenerate
  # — the embedded fallback path can change across containers.
  if [ -e "$dest" ] && [ ! -L "$dest" ] && ! grep -qF "$VP_SHIM_MARKER" "$dest" 2>/dev/null; then
    return 0
  fi
  cat >"$dest.tmp" <<SHIM
#!/usr/bin/env bash
$VP_SHIM_MARKER
dir="\$PWD"
while [ -n "\$dir" ]; do
  if [ -x "\$dir/node_modules/vite-plus/bin/vp" ]; then
    exec "\$dir/node_modules/vite-plus/bin/vp" "\$@"
  fi
  [ "\$dir" = "/" ] && break
  dir="\$(dirname "\$dir")"
done
exec "$PROJECT_DIR/node_modules/vite-plus/bin/vp" "\$@"
SHIM
  chmod +x "$dest.tmp" 2>/dev/null && mv -f "$dest.tmp" "$dest" 2>/dev/null \
    || { rm -f "$dest.tmp" 2>/dev/null; log "could not write vp shim"; }
}

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

# node_modules/.bin only exists after the install, so link what it provides now.
link_tool "$PROJECT_DIR/node_modules/.bin/fallow"
write_vp_shim

exit 0
