/**
 * Unit tests for `JsonValidity.jsonValidity`.
 *
 * @module tests/scorers/json-validity
 */

import { describe, expect, it } from "vite-plus/test";
import { JsonValidity } from "@thomasfosterau/effect-evals";
import { runTest } from "@test-helpers/effect";

describe("JsonValidity.jsonValidity", () => {
  it("scores 1 for a valid JSON object", async () => {
    const score = await runTest(
      JsonValidity.jsonValidity.evaluate({ output: '{"name":"Alice","age":30}' }),
    );
    expect(score).toEqual({ score: 1 });
  });

  it("scores 1 for a valid JSON scalar", async () => {
    const score = await runTest(JsonValidity.jsonValidity.evaluate({ output: "42" }));
    expect(score).toEqual({ score: 1 });
  });

  it("scores 0 with the parse error as reason for invalid JSON", async () => {
    const score = await runTest(JsonValidity.jsonValidity.evaluate({ output: "{not valid json" }));
    expect(score.score).toBe(0);
    expect(score.reason).toBeTruthy();
  });

  it("scores 0 for an empty string", async () => {
    const score = await runTest(JsonValidity.jsonValidity.evaluate({ output: "" }));
    expect(score.score).toBe(0);
  });
});
