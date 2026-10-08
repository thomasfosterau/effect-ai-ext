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

/**
 * The deprecated `RerankerModel` re-export from effect-ai-ext (#60): every
 * value name the former `export *` carried, removed from the gateway in 0.5.0.
 */
const DEPRECATED_RERANKER_EXPORTS = [
  "make",
  "RerankedDocument",
  "RerankerModel",
  "RerankerUsage",
  "RerankResponse",
] as const;

describe("module load", () => {
  it("imports the package entry and exposes every provider constructor", async () => {
    const entry: Record<string, unknown> = await import("@thomasfosterau/effect-ai-gateway");

    expect(Object.keys(entry)).toEqual(expect.arrayContaining([...EXPORTS]));
    for (const name of EXPORTS) {
      expect(entry[name], name).toBeDefined();
    }
  });

  it("still re-exports every RerankerModel value from effect-ai-ext, by identity", async () => {
    const entry: Record<string, unknown> = await import("@thomasfosterau/effect-ai-gateway");
    const ext: Record<string, unknown> = RerankerModelExt;

    // The named list must cover everything effect-ai-ext exports, or dropping
    // the `export *` silently removed a name (a breaking change).
    expect([...DEPRECATED_RERANKER_EXPORTS].sort()).toEqual(Object.keys(ext).sort());
    for (const name of DEPRECATED_RERANKER_EXPORTS) {
      expect(entry[name], name).toBe(ext[name]);
    }
  });

  it("builds gatewayUrlConfig at module scope (the Config.string crash site)", async () => {
    const { gatewayUrlConfig } = await import("@thomasfosterau/effect-ai-gateway");

    expect(Config.isConfig(gatewayUrlConfig)).toBe(true);
  });
});
