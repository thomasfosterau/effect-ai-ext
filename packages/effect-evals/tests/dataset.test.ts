/**
 * Unit tests for the `Dataset` seam: inline goldens, and goldens produced by
 * an arbitrary effect.
 *
 * @module tests/dataset
 */

import { describe, expect, it } from "vite-plus/test";
import { Dataset } from "../src/index.ts";
import { runTest } from "./helpers/effect.ts";

describe("Dataset.fromArray", () => {
  it("wraps an inline array of goldens as an effect", async () => {
    const dataset = Dataset.fromArray("greetings", ["Bonjour", "Ciao"]);

    expect(dataset.name).toBe("greetings");
    const goldens = await runTest(dataset.goldens);
    expect(goldens).toEqual(["Bonjour", "Ciao"]);
  });
});
