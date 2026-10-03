#!/usr/bin/env node
/**
 * @copyright Thomas Foster
 *
 * The `effect-evals` bin. A plain, flagless `node` launcher that re-execs
 * itself as `node --disable-warning=ExperimentalWarning
 * --import <loader.mjs> <dist/cli/main.js> …argv`. The CLI itself is BUILT
 * JavaScript (`dist/cli/main.js`) because Node refuses to type-strip anything
 * under `node_modules` (issue #42); the loader hook plus Node's native type
 * stripping exist only for the consumer's own `*.eval.ts` files, which live
 * outside `node_modules`. Flags and the loader import are literal argv on this
 * one `node` invocation (never `NODE_OPTIONS` — see
 * docs/decisions/run-the-toolchain-under-node.md for why that distinction is
 * load-bearing), and this is the ONLY hop, so nothing downstream can lose them.
 *
 * `--disable-warning=ExperimentalWarning` hides only that warning type: on
 * Node 23.x and early 24.x, inside the `>=22.18` engines range,
 * `fs.promises.glob` and type stripping each still print one on every run.
 * Never `--no-warnings=…`: Node ignores its value and hides every warning,
 * `DeprecationWarning`s included (#81).
 *
 * Run `pnpm run build` before using the bin from the workspace.
 *
 * @module bin/effect-evals
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const loader = path.join(dir, "..", "src", "cli", "loader.mjs");
const entry = path.join(dir, "..", "dist", "cli", "main.js");

if (!existsSync(entry)) {
  console.error(
    `effect-evals: ${entry} does not exist. In the workspace, run \`pnpm run build\` first.`,
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", "--import", loader, entry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
