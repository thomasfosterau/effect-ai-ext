/**
 * Unit tests for `SchemaMatch.schemaMatch` and `SchemaMatch.schemaMatchValue`.
 *
 * @module tests/scorers/schema-match
 */

import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { SchemaMatch } from "../../src/index.ts";
import { runTest, runTestExit } from "../helpers/effect.ts";

const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite });

/** A schema whose decode transformation dies: a bug, not a decode failure. */
const Exploding = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformEffect(() => Effect.die(new Error("boom: transformation bug"))),
    encode: SchemaGetter.passthrough(),
  }),
);

const expectDie = async (program: Effect.Effect<unknown>): Promise<void> => {
  const exit = await runTestExit(program);
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return;
  expect(Cause.hasDies(exit.cause)).toBe(true);
  expect(String(Cause.squash(exit.cause))).toContain("boom: transformation bug");
};

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

  it("dies, rather than scoring 0, when the schema's transformation dies", async () => {
    await expectDie(SchemaMatch.schemaMatch(Exploding).evaluate({ output: '"x"' }));
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

  it("dies, rather than scoring 0, when the schema's transformation dies", async () => {
    await expectDie(SchemaMatch.schemaMatchValue(Exploding).evaluate({ output: "x" }));
  });
});
