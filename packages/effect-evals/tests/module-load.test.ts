/**
 * Module-load smoke test (issue #32).
 *
 * Imports the package entry, so every top-level statement in every module
 * runs against the workspace's pinned `effect`, and checks the public surface
 * is all there; then launches the real `effect-evals` bin, which loads the
 * CLI (`effect/unstable/cli` flags built at module scope) and
 * `@effect/platform-node` exactly as a consumer's `npx effect-evals` does.
 * `effect-ai-gateway@0.1.1` crashed at this point on `effect@4.0.0-rc.115`
 * (`TypeError: Config.string is not a function`); the CLI's `Flag.string` /
 * `Flag.integer` were the same shape of break here.
 *
 * @module tests/module-load
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const NAMESPACES = [
  "AnswerRelevancy",
  "Cache",
  "ContextualPrecision",
  "ContextualRecall",
  "ContextualRelevancy",
  "Dataset",
  "EvalCase",
  "EvalFile",
  "ExtractThenClassify",
  "Faithfulness",
  "GEval",
  "Golden",
  "Metadata",
  "Metric",
  "RagCase",
  "Ranking",
  "Reporter",
  "Result",
  "Runner",
  "Score",
  "Scorer",
  "Threshold",
  "EmbeddingSimilarity",
  "ExactMatch",
  "JsonValidity",
  "Levenshtein",
  "SchemaMatch",
  "ToolCallCorrectness",
] as const;

const BIN = fileURLToPath(new URL("../bin/effect-evals.js", import.meta.url));

describe("module load", () => {
  it("imports the package entry and exposes every namespace", async () => {
    const entry: Record<string, unknown> = await import("@thomasfosterau/effect-evals");

    expect(Object.keys(entry)).toEqual(expect.arrayContaining([...NAMESPACES]));
    for (const name of NAMESPACES) {
      expect(entry[name], name).toBeTypeOf("object");
    }
  });

  it("starts the effect-evals bin and prints its help", () => {
    const result = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8" });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("effect-evals <subcommand>");
  });
});
