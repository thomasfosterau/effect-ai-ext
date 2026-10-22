/**
 * Unit tests for `RagCase.ts`'s shared helpers: the `requireX` typed-error
 * guards, `renderContext`'s rank-numbered rendering, and `renderValue`
 * (reused directly from `GEval.ts`) rendering array-shaped case fields as
 * one item per line rather than an opaque JSON blob.
 *
 * @module tests/metrics/rag/rag-case
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { GEval, RagCase } from "../../../src/index.ts";
import { expectFailureInstanceOf, runTest } from "../../helpers/effect.ts";

describe("RagCase.renderValue", () => {
  it("returns a string field as-is", () => {
    expect(RagCase.renderValue("hello")).toBe("hello");
  });

  it("renders an array-shaped field one item per line, not as a JSON blob", () => {
    expect(RagCase.renderValue(["Paris is a city.", "It hosts the Louvre."])).toBe(
      "Paris is a city.\nIt hosts the Louvre.",
    );
  });

  it("renders a value JSON cannot represent through String, and an array item as an empty line", () => {
    expect(RagCase.renderValue(undefined)).toBe("undefined");
    expect(RagCase.renderValue(["a fact", undefined, "another"])).toBe("a fact\n\nanother");
  });

  it("JSON-stringifies a non-string, non-array item within an array", () => {
    expect(RagCase.renderValue(["a fact", { note: "structured" }])).toBe(
      'a fact\n{"note":"structured"}',
    );
  });

  it("JSON-stringifies a plain object field", () => {
    expect(RagCase.renderValue({ fact: "Paris is a city." })).toBe('{"fact":"Paris is a city."}');
  });
});

describe("RagCase.renderContext", () => {
  it("numbers each chunk by rank, preserving order", () => {
    expect(RagCase.renderContext(["first chunk", "second chunk"])).toBe(
      "[1] first chunk\n[2] second chunk",
    );
  });

  it("renders an empty context as an empty string", () => {
    expect(RagCase.renderContext([])).toBe("");
  });
});

describe("RagCase require* helpers", () => {
  const metricName = "test-metric";

  it("requireInput fails with GEval.MissingEvaluationParamError when golden.input is null or undefined", async () => {
    const missingUndefined = await expectFailureInstanceOf(
      RagCase.requireInput(metricName, { golden: { input: undefined }, output: "y" }).pipe(
        Effect.asVoid,
      ),
      GEval.MissingEvaluationParamError,
    );
    expect(missingUndefined.param).toBe("input");

    const missingNull = await expectFailureInstanceOf(
      RagCase.requireInput(metricName, { golden: { input: null }, output: "y" }).pipe(
        Effect.asVoid,
      ),
      GEval.MissingEvaluationParamError,
    );
    expect(missingNull.param).toBe("input");
  });

  it("requireInput succeeds with the raw value when present", async () => {
    const value = await runTest(
      RagCase.requireInput(metricName, { golden: { input: "x" }, output: "y" }),
    );
    expect(value).toBe("x");
  });

  it("requireRetrievedContext treats an empty array as present, not missing", async () => {
    const value = await runTest(
      RagCase.requireRetrievedContext(metricName, {
        golden: { input: "x" },
        output: "y",
        retrievedContext: [],
      }),
    );
    expect(value).toEqual([]);
  });

  it("requireRetrievedContext fails when the field is absent", async () => {
    const failure = await expectFailureInstanceOf(
      RagCase.requireRetrievedContext(metricName, { golden: { input: "x" }, output: "y" }).pipe(
        Effect.asVoid,
      ),
      GEval.MissingEvaluationParamError,
    );
    expect(failure.param).toBe("retrievedContext");
    expect(failure.metric).toBe(metricName);
  });
});
