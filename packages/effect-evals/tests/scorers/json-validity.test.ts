/**
 * Unit tests for `JsonValidity.jsonValidity`.
 *
 * @module tests/scorers/json-validity
 */

import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import {
  Cache,
  Dataset,
  JsonValidity,
  Metric,
  Runner,
  Scorer,
  Threshold,
} from "../../src/index.ts";
import { runTest, runTestExit } from "../helpers/effect.ts";

/**
 * A case whose `output` cannot even be read: the getter throws a plain
 * `Error`, not the `SyntaxError` of unparseable text. It stands in for a
 * failure that is no verdict on the output (a bug in a case adapter).
 */
class AdapterBug extends Schema.TaggedError<AdapterBug>()("AdapterBug", {
  message: Schema.String,
}) {}

const unreadableCase = (): JsonValidity.JsonCase => ({
  get output(): string {
    throw new AdapterBug({ message: "boom: unreadable output" });
  },
});

const jsonSuite = (
  toCase: (evalCase: Runner.EvaluatedCase<string, string>) => JsonValidity.JsonCase,
) =>
  Runner.makeSuite({
    name: "json",
    dataset: Dataset.fromArray("json", ["{not valid json"]),
    task: Runner.makeTask<string, string>({ id: "json@v1", run: Effect.succeed }),
    metrics: [
      Metric.makeMetric({
        name: "json-validity",
        scorer: Scorer.contramap(JsonValidity.jsonValidity, toCase),
        threshold: Threshold.strict,
      }),
    ],
  });

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

  it("reports the SyntaxError's own message as the reason", async () => {
    const score = await runTest(JsonValidity.jsonValidity.evaluate({ output: "{not valid json" }));
    expect(score.reason).toMatch(/JSON/);
  });

  it("dies, rather than scoring 0, when parsing throws anything but a SyntaxError", async () => {
    const exit = await runTestExit(JsonValidity.jsonValidity.evaluate(unreadableCase()));
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(String(Cause.squash(exit.cause))).toContain("boom: unreadable output");
  });

  it("scores 0 for an empty string", async () => {
    const score = await runTest(JsonValidity.jsonValidity.evaluate({ output: "" }));
    expect(score.score).toBe(0);
  });
});

describe("JsonValidity.jsonValidity — inside a run", () => {
  it("an unparseable output scores 0 and the run completes", async () => {
    const result = await runTest(
      Runner.runSuite(
        jsonSuite((evalCase) => ({ output: evalCase.output })),
        { bypassCache: true },
      ).pipe(Effect.provide(Cache.layerMemory)),
    );
    expect(result.passed).toBe(false);
    expect(result.cases[0]?.metrics[0]?.trials[0]).toMatchObject({
      _tag: "Scored",
      score: { score: 0 },
    });
  });

  it("an unexpected parse failure fails the run instead of scoring 0", async () => {
    const exit = await runTestExit(
      Runner.runSuite(jsonSuite(unreadableCase), { bypassCache: true }).pipe(
        Effect.provide(Cache.layerMemory),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.hasDies(exit.cause)).toBe(true);
  });
});
