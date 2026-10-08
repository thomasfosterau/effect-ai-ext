/**
 * Unit tests for `JsonValidity.jsonValidity`.
 *
 * @module tests/scorers/json-validity
 */

import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
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
 * An `output` that is not the string `JsonCase` promises: coercing it for
 * `JSON.parse` throws a plain `Error`, not the `SyntaxError` of unparseable
 * text — the stand-in for a failure that is no verdict on the output.
 */
const unparseableByContract = (): string => {
  const exploding = {
    toString: (): string => {
      throw new Error("boom: not a string");
    },
  };
  // SAFETY: deliberately breaks the `string` contract to reach the
  // non-`SyntaxError` path; nothing reads it as a string.
  return exploding as unknown as string;
};

const jsonMetric = Metric.makeMetric({
  name: "json-validity",
  scorer: Scorer.contramap(
    JsonValidity.jsonValidity,
    (evalCase: Runner.EvaluatedCase<string, string>) => ({ output: evalCase.output }),
  ),
  threshold: Threshold.strict,
});

const suiteWithOutput = (output: () => string) =>
  Runner.makeSuite({
    name: "json",
    dataset: Dataset.fromArray("json", ["case"]),
    task: Runner.makeTask<string, string>({ id: "json@v1", run: () => Effect.sync(output) }),
    metrics: [jsonMetric],
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
    const parseError: unknown = Effect.runSync(
      Effect.flip(
        Effect.try({ try: () => JSON.parse("{not valid json"), catch: (cause) => cause }),
      ),
    );
    expect(parseError).toBeInstanceOf(SyntaxError);
    const score = await runTest(JsonValidity.jsonValidity.evaluate({ output: "{not valid json" }));
    expect(score).toEqual({
      score: 0,
      reason: parseError instanceof SyntaxError ? parseError.message : undefined,
    });
  });

  it("dies, rather than scoring 0, when parsing throws anything but a SyntaxError", async () => {
    const exit = await runTestExit(
      JsonValidity.jsonValidity.evaluate({ output: unparseableByContract() }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(String(Cause.squash(exit.cause))).toContain("boom: not a string");
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
        suiteWithOutput(() => "{not valid json"),
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
      Runner.runSuite(suiteWithOutput(unparseableByContract), { bypassCache: true }).pipe(
        Effect.provide(Cache.layerMemory),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.hasDies(exit.cause)).toBe(true);
  });
});
