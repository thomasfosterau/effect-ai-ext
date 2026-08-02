#!/usr/bin/env node
/**
 * @copyright Thomas Foster
 *
 * The `effect-evals` bin. A plain, flagless `node` launcher that re-execs
 * itself as `node --no-warnings=ExperimentalWarning
 * --import <loader.mjs> <cli/main.ts> …argv` — Node's native type-stripping
 * plus this package's own extensionless-import resolution hook, never tsx,
 * per docs/decisions/run-the-toolchain-under-node.md. Flags and the loader
 * import are literal argv on this one `node` invocation (never
 * `NODE_OPTIONS` — see the decision doc for why that distinction is
 * load-bearing), and this is the ONLY hop: unlike Alchemy's `bin/cli.js`
 * (which silently drops any flags given to it by re-spawning a flagless
 * child of its own), this script controls the exact argv the real `node`
 * process receives, so nothing downstream can lose them.
 *
 * @module bin/effect-evals
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const loader = path.join(dir, "..", "src", "cli", "loader.mjs");
const entry = path.join(dir, "..", "src", "cli", "main.ts");

const result = spawnSync(
  process.execPath,
  ["--no-warnings=ExperimentalWarning", "--import", loader, entry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
