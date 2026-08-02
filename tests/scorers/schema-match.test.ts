/**
 * Unit tests for `SchemaMatch.schemaMatch` and `SchemaMatch.schemaMatchValue`.
 *
 * @module tests/scorers/schema-match
 */

import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { SchemaMatch } from "@thomasfosterau/effect-evals";
import { runTest } from "@test-helpers/effect";

const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite });

describe("SchemaMatch.schemaMatch", () => {
  it("scores 1 when output decodes against the schema", async () => {
    const scorer = SchemaMatch.schemaMatch(Person);
    const score = await runTest(scorer.evaluate({ output: '{"name":"Alice","age":30}' }));
    expect(score).toEqual({ score: 1 });
  });

  it("scores 0 with the decode error as reason when a field is missing", async () => {
    const scorer = SchemaMatch.schemaMatch(Person);
    const score = await runTest(scorer.evaluate({ output: '{"name":"Alice"}' }));
    expect(score.score).toBe(0);
    expect(score.reason).toBeTruthy();
  });

  it("scores 0 with the decode error as reason when a field has the wrong type", async () => {
    const scorer = SchemaMatch.schemaMatch(Person);
    const score = await runTest(scorer.evaluate({ output: '{"name":"Alice","age":"thirty"}' }));
    expect(score.score).toBe(0);
    expect(score.reason).toBeTruthy();
  });

  it("scores 0 when output isn't valid JSON at all", async () => {
    const scorer = SchemaMatch.schemaMatch(Person);
    const score = await runTest(scorer.evaluate({ output: "not json" }));
    expect(score.score).toBe(0);
    expect(score.reason).toBeTruthy();
  });
});

describe("SchemaMatch.schemaMatchValue", () => {
  it("scores 1 when an already-structured output decodes against the schema", async () => {
    const scorer = SchemaMatch.schemaMatchValue(Person);
    const score = await runTest(scorer.evaluate({ output: { name: "Alice", age: 30 } }));
    expect(score).toEqual({ score: 1 });
  });

  it("scores 0 with the decode error as reason when a field is missing", async () => {
    const scorer = SchemaMatch.schemaMatchValue(Person);
    const score = await runTest(scorer.evaluate({ output: { name: "Alice" } }));
    expect(score.score).toBe(0);
    expect(score.reason).toBeTruthy();
  });

  it("scores 0 with the decode error as reason when a field has the wrong type", async () => {
    const scorer = SchemaMatch.schemaMatchValue(Person);
    const score = await runTest(scorer.evaluate({ output: { name: "Alice", age: "thirty" } }));
    expect(score.score).toBe(0);
    expect(score.reason).toBeTruthy();
  });

  it("never round-trips through JSON.stringify — a value with a non-serializable field still decodes", async () => {
    const WithDate = Schema.Struct({ name: Schema.String, seenAt: Schema.Unknown });
    const scorer = SchemaMatch.schemaMatchValue(WithDate);
    const nonSerializable = { name: "Alice", seenAt: new Date() };
    const score = await runTest(scorer.evaluate({ output: nonSerializable }));
    expect(score).toEqual({ score: 1 });
  });
});
