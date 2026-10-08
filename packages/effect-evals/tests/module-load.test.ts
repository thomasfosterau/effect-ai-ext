/**
 * Module-load smoke test (issue #32).
 *
 * Imports the package entry, so every top-level statement in every module
 * runs against the workspace's pinned `effect`, and checks the public surface
 * is all there. `effect-ai-gateway@0.1.1` crashed at module load on
 * `effect@4.0.0-rc.115` (`TypeError: Config.string is not a function`).
 *
 * The `effect-evals` bin is deliberately NOT launched here: it runs the built
 * `dist/cli/main.js`, and the unit-test job runs without a build. It is proved
 * from a packed tarball unpacked under `node_modules` by `vp run
 * check:dist` (issue #42), which is the only place that can prove it.
 *
 * @module tests/module-load
 */

import { describe, expect, it } from "vite-plus/test";

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

describe("module load", () => {
  it("imports the package entry and exposes every namespace", async () => {
    const entry: Record<string, unknown> = await import("@thomasfosterau/effect-evals");

    expect(Object.keys(entry)).toEqual(expect.arrayContaining([...NAMESPACES]));
    for (const name of NAMESPACES) {
      expect(entry[name], name).toBeTypeOf("object");
    }
  });
});
