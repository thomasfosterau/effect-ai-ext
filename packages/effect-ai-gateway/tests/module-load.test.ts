/**
 * Module-load smoke test (issue #32).
 *
 * Imports the package entry, so every top-level statement in every module
 * runs against the workspace's pinned `effect`, and checks the public surface
 * is all there. `effect-ai-gateway@0.1.1` crashed at exactly this point on
 * `effect@4.0.0-rc.115` (`TypeError: Config.string is not a function`, from a
 * top-level `Config.all({ … })` in `Url.ts`) before any behavioural test got
 * to run. A renamed or removed upstream export used at module scope fails
 * here first.
 *
 * @module tests/module-load
 */

import { describe, expect, it } from "vite-plus/test";
import * as Config from "effect/Config";
import * as EffectRecord from "effect/Record";
import * as RerankerModelExt from "@thomasfosterau/effect-ai-ext/RerankerModel";

const EXPORTS = [
  "anthropicLanguageModelLayer",
  "anthropicLanguageModelLayerFromUrl",
  "cfAigAuthorizationHeader",
  "gatewayBaseUrl",
  "gatewayRun",
  "gatewayUrl",
  "gatewayUrlConfig",
  "makeCohereEmbeddingModel",
  "makeCohereEmbeddingModelFromUrl",
  "makeCohereReranker",
  "makeCohereRerankerFromUrl",
  "makeOpenAiModerationModel",
  "makeOpenAiModerationModelFromUrl",
] as const;

describe("module load", () => {
  it("imports the package entry and exposes every provider constructor", async () => {
    const entry: Record<string, unknown> = await import("@thomasfosterau/effect-ai-gateway");

    expect(EffectRecord.keys(entry)).toEqual(expect.arrayContaining([...EXPORTS]));
  });

  it.each(EXPORTS)("exposes %s from the package entry", async (name) => {
    const entry = await import("@thomasfosterau/effect-ai-gateway");

    expect(entry[name], name).toBeDefined();
  });

  it.each(EffectRecord.keys(RerankerModelExt))(
    "re-exports no RerankerModel value %s (removed in 0.5.0, #97)",
    async (name) => {
      const entry: Record<string, unknown> = await import("@thomasfosterau/effect-ai-gateway");

      expect(entry, name).not.toHaveProperty(name);
    },
  );

  it("builds gatewayUrlConfig at module scope (the Config.string crash site)", async () => {
    const { gatewayUrlConfig } = await import("@thomasfosterau/effect-ai-gateway");

    expect(Config.isConfig(gatewayUrlConfig)).toBe(true);
  });
});
