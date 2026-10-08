/**
 * Tests for `bin/effect-evals.js`'s Node flags (#81): the bin hides Node's
 * `ExperimentalWarning`s (`fs.promises.glob` and type stripping still emit
 * one on Node 23.x and early 24.x, inside the `>=22.18` engines range) and
 * nothing else, so a `DeprecationWarning` raised while a consumer's
 * `*.eval.ts` file loads still reaches stderr. `--no-warnings=…` would hide
 * it: Node ignores that flag's value and silences every warning, which is how
 * DEP0205 (#72) stayed hidden for CLI users.
 *
 * The unit-test job runs without a build, so the real bin and loader are
 * copied into a scratch package whose `dist/cli/main.js` imports the CLI's
 * TypeScript source (type-stripped by Node, as it is outside `node_modules`).
 * The bin's own argv is what runs; only the entry it launches is swapped.
 * `vp run check:dist` covers the built entry from an installed path.
 *
 * @module tests/cli/bin
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const source = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "effect-evals-bin-"));
  for (const dir of ["bin", "src/cli", "dist/cli"]) {
    mkdirSync(path.join(scratch, dir), { recursive: true });
  }
  copyFileSync(source("../../bin/effect-evals.js"), path.join(scratch, "bin", "effect-evals.js"));
  copyFileSync(source("../../src/cli/loader.mjs"), path.join(scratch, "src", "cli", "loader.mjs"));
  const main = new URL("../../src/cli/main.ts", import.meta.url).href;
  writeFileSync(path.join(scratch, "dist", "cli", "main.js"), `import ${JSON.stringify(main)};\n`);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("bin/effect-evals", () => {
  it("lets a DeprecationWarning from an eval file reach stderr", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(scratch, "bin", "effect-evals.js"), "run", source("../fixtures/warning.eval.ts")],
      // The CLI writes `.effect-evals/` under its cwd; keep it in the scratch dir.
      { cwd: scratch, encoding: "utf8" },
    );

    expect(result.stderr).toContain("DeprecationWarning: effect-evals fixture warning");
    expect(result.stderr).not.toContain("ExperimentalWarning");
    expect(result.status).toBe(0);
  });
});
