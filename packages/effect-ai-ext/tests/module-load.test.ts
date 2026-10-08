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

/** This package's own abstractions — each also published as a subpath. */
const NAMESPACES = [
  "RerankerModel",
  "ClassifierModel",
  "SpeechModel",
  "TranscriptionModel",
  "ImageModel",
  "ModerationModel",
  "VoiceConversionModel",
] as const;

describe("module load", () => {
  it("imports the package entry and exposes every abstraction plus the effect/ai re-export", async () => {
    const entry: Record<string, unknown> = await import("@thomasfosterau/effect-ai-ext");

    expect(Object.keys(entry)).toEqual(
      expect.arrayContaining([...NAMESPACES, "AiError", "EmbeddingModel", "LanguageModel"]),
    );
    for (const name of NAMESPACES) {
      expect(entry[name], name).toBeTypeOf("object");
    }
  });

  it.each(NAMESPACES)("imports the ./%s subpath", async (name) => {
    const subpath: Record<string, unknown> = await import(`@thomasfosterau/effect-ai-ext/${name}`);

    expect(Object.keys(subpath).length).toBeGreaterThan(0);
  });
});
