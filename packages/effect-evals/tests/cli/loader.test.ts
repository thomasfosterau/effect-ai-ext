/**
 * Tests for `cli/loader.mjs`, run the way `bin/effect-evals.js` runs it: a
 * child `node --import <loader.mjs>` resolves extensionless and directory
 * specifiers, and installing the hook (`module.registerHooks()`, #72) prints
 * nothing to stderr — in particular no DEP0205 `module.register()`
 * deprecation warning.
 *
 * @module tests/cli/loader
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const loader = fileURLToPath(new URL("../../src/cli/loader.mjs", import.meta.url));
const entry = fileURLToPath(new URL("../fixtures/loader/entry.mjs", import.meta.url));

describe("cli/loader", () => {
  it("resolves extensionless and directory imports without any warning", () => {
    // No `--no-warnings` flag (the bin passes one): on Node 26 it would also
    // hide the DEP0205 warning this test exists to catch.
    const result = spawnSync(process.execPath, ["--import", loader, entry], {
      encoding: "utf8",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("dep+sub");
  });

  it("fails an extensionless import without the loader (the gap it fills)", () => {
    const result = spawnSync(process.execPath, [entry], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ERR_MODULE_NOT_FOUND");
  });
});
