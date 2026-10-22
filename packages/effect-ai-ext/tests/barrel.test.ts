/**
 * The `@thomasfosterau/effect-ai-ext` barrel is a superset of
 * `effect/ai`: it re-exports every upstream AI module alongside the
 * extension abstractions, and those re-exports are the same identities as
 * upstream (one singleton `effect`), so mixing import styles is safe.
 *
 * @module tests/barrel
 */

import { describe, expect, it } from "vite-plus/test";
import * as EffectRecord from "effect/Record";
import * as UpstreamAi from "effect/ai";
import * as Ext from "@thomasfosterau/effect-ai-ext";

/** The extension abstractions this package adds on top of `effect/ai`. */
const EXTENSION_ONLY = [
  "RerankerModel",
  "ClassifierModel",
  "SpeechModel",
  "TranscriptionModel",
  "ImageModel",
  "ModerationModel",
  "VoiceConversionModel",
] as const;

describe("effect-ai-ext barrel", () => {
  it.each(EXTENSION_ONLY)("re-exports the %s extension abstraction", (name) => {
    expect(Ext[name], name).toBeDefined();
  });

  it.each(EffectRecord.keys(UpstreamAi))("re-exports the upstream effect/ai %s module", (name) => {
    expect(Ext, name).toHaveProperty(name);
  });

  it("re-exports upstream modules as the same identities (one singleton effect)", () => {
    // Referential equality proves nothing was wrapped or re-bundled — the
    // Context tags / Schema classes are shared, so a service provided against
    // one import resolves against the other.
    expect((Ext as Record<string, unknown>).LanguageModel).toBe(UpstreamAi.LanguageModel);
    expect((Ext as Record<string, unknown>).EmbeddingModel).toBe(UpstreamAi.EmbeddingModel);
    expect((Ext as Record<string, unknown>).AiError).toBe(UpstreamAi.AiError);
  });

  it.each(EXTENSION_ONLY)("does not collide the %s extension with an upstream name", (name) => {
    expect(UpstreamAi, `${name} must not exist upstream`).not.toHaveProperty(name);
  });
});
