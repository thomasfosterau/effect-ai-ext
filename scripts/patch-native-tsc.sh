#!/usr/bin/env sh
# Idempotently apply the Effect-patched native TypeScript (TS7) `tsc` binary.
#
# `effect-tsgo patch` is NOT self-skipping: it unconditionally renames the
# current native `tsc` to `tsc.original[.N]` (~30 MB each) and copies its own
# Effect-built binary over it. Running it on every `pnpm install` (this script
# is the root `prepare`) would accumulate backups and eventually trip
# effect-tsgo's "over 100 backups" hard error. Guard on the version the
# installed `tsc` already reports so a re-run against a matching install is a
# no-op, while a fresh install or an @effect/tsgo bump still re-patches.
#
# See AGENTS.md -> Toolchain (the TypeScript 6/7 side-by-side split). Fails
# open with a warning: a missing patch only loses the effect-specific
# diagnostics, it does not break plain type-checking.
set -e

# `tsc` here is node_modules/.bin/tsc = the native TS7 compiler (TS6 is `tsc6`).
# A patched binary reports e.g. "Version 7.0.2+effect-tsgo.0.24.1"; match the
# exact installed @effect/tsgo version so an upgrade re-patches instead of
# silently keeping the stale binary.
if ! command -v node >/dev/null 2>&1; then
  echo "patch-native-tsc: node not found; skipping" >&2
  exit 0
fi

tsgo_version="$(node -p "require('@effect/tsgo/package.json').version" 2>/dev/null || echo "")"
if [ -z "$tsgo_version" ]; then
  echo "patch-native-tsc: @effect/tsgo not installed yet; skipping" >&2
  exit 0
fi
want="+effect-tsgo.$tsgo_version"

if tsc --version 2>/dev/null | grep -qF "$want"; then
  echo "native tsc already patched ($want); skipping effect-tsgo patch"
else
  effect-tsgo patch || echo "patch-native-tsc: effect-tsgo patch failed (non-fatal)" >&2
fi
