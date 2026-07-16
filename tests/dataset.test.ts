/**
 * Unit tests for the `Dataset` seam: inline goldens, and goldens produced by
 * an arbitrary effect.
 *
 * @module tests/dataset
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { Dataset } from "@thomasfosterau/effect-evals";
import { runTest } from "@test-helpers/effect";

describe("Dataset.fromArray", () => {
  it("wraps an inline array of goldens as an effect", async () => {
    const dataset = Dataset.fromArray("greetings", ["Bonjour", "Ciao"]);

    expect(dataset.name).toBe("greetings");
    const goldens = await runTest(dataset.goldens);
    expect(goldens).toEqual(["Bonjour", "Ciao"]);
  });
});

describe("Dataset.makeDataset", () => {
  it("keeps the goldens seam open to an arbitrary effect", async () => {
    const dataset = Dataset.makeDataset({
      name: "computed",
      goldens: Effect.succeed(["a", "b", "c"]),
    });

    const goldens = await runTest(dataset.goldens);
    expect(goldens).toHaveLength(3);
  });
});
