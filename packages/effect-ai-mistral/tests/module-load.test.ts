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

import { describe, expect, it } from "vitest";

const NAMESPACES = ["MistralClient", "MistralLanguageModel"] as const;

describe("module load", () => {
  it("imports the package entry and exposes every namespace", async () => {
    const entry: Record<string, unknown> = await import("@thomasfosterau/effect-ai-mistral");

    expect(Object.keys(entry)).toEqual(expect.arrayContaining([...NAMESPACES]));
    for (const name of NAMESPACES) {
      expect(entry[name], name).toBeTypeOf("object");
    }
  });
});
