/**
 * The `@thomasfosterau/effect-ai-ext` barrel is a superset of
 * `effect/unstable/ai`: it re-exports every upstream AI module alongside the
 * extension abstractions, and those re-exports are the same identities as
 * upstream (one singleton `effect`), so mixing import styles is safe.
 *
 * @module tests/barrel
 */

import { describe, expect, it } from "vitest";
import * as UpstreamAi from "effect/unstable/ai";
import * as Ext from "@thomasfosterau/effect-ai-ext";

describe("effect-ai-ext barrel", () => {
  it("re-exports the extension abstractions", () => {
    for (const name of [
      "RerankerModel",
      "ClassifierModel",
      "SpeechModel",
      "TranscriptionModel",
      "ImageModel",
      "ModerationModel",
      "VoiceConversionModel",
    ] as const) {
      expect(Ext[name], name).toBeDefined();
    }
  });

  it("re-exports every upstream effect/unstable/ai module", () => {
    for (const name of Object.keys(UpstreamAi)) {
      expect(Ext, name).toHaveProperty(name);
    }
  });

  it("re-exports upstream modules as the same identities (one singleton effect)", () => {
    // Referential equality proves nothing was wrapped or re-bundled — the
    // Context tags / Schema classes are shared, so a service provided against
    // one import resolves against the other.
    expect((Ext as Record<string, unknown>).LanguageModel).toBe(UpstreamAi.LanguageModel);
    expect((Ext as Record<string, unknown>).EmbeddingModel).toBe(UpstreamAi.EmbeddingModel);
    expect((Ext as Record<string, unknown>).AiError).toBe(UpstreamAi.AiError);
  });

  it("does not collide upstream and extension names", () => {
    const upstream = new Set(Object.keys(UpstreamAi));
    const extensionOnly = [
      "RerankerModel",
      "ClassifierModel",
      "SpeechModel",
      "TranscriptionModel",
      "ImageModel",
      "ModerationModel",
      "VoiceConversionModel",
    ];
    for (const name of extensionOnly) {
      expect(upstream.has(name), `${name} must not exist upstream`).toBe(false);
    }
  });
});
