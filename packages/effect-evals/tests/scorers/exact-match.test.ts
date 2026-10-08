/**
 * Unit tests for `ExactMatch.exactMatch` / `ExactMatch.normalizedMatch`.
 *
 * @module tests/scorers/exact-match
 */

import { describe, expect, it } from "vite-plus/test";
import { ExactMatch } from "../../src/index.ts";
import { runTest } from "../helpers/effect.ts";

describe("ExactMatch.exactMatch", () => {
  it("scores 1 when output matches golden.expected exactly", async () => {
    const score = await runTest(
      ExactMatch.exactMatch.evaluate({ golden: { expected: "Hello" }, output: "Hello" }),
    );
    expect(score).toEqual({ score: 1, reason: "matched" });
  });

  it("scores 0 when output differs from golden.expected", async () => {
    const score = await runTest(
      ExactMatch.exactMatch.evaluate({ golden: { expected: "Hello" }, output: "hello" }),
    );
    expect(score).toEqual({ score: 0, reason: "mismatched" });
  });

  it("scores 0 when golden has no expected output", async () => {
    const score = await runTest(ExactMatch.exactMatch.evaluate({ golden: {}, output: "Hello" }));
    expect(score).toEqual({ score: 0, reason: "golden.expected is undefined" });
  });
});

describe("ExactMatch.normalizedMatch", () => {
  it("behaves like exactMatch with no options", async () => {
    const scorer = ExactMatch.normalizedMatch();
    const score = await runTest(
      scorer.evaluate({ golden: { expected: "Hello" }, output: "hello" }),
    );
    expect(score.score).toBe(0);
  });

  it("ignores surrounding whitespace when trim is set", async () => {
    const scorer = ExactMatch.normalizedMatch({ trim: true });
    const score = await runTest(
      scorer.evaluate({ golden: { expected: "Hello" }, output: "  Hello  " }),
    );
    expect(score).toEqual({ score: 1, reason: "matched" });
  });

  it("ignores case when caseInsensitive is set", async () => {
    const scorer = ExactMatch.normalizedMatch({ caseInsensitive: true });
    const score = await runTest(
      scorer.evaluate({ golden: { expected: "Hello World" }, output: "HELLO WORLD" }),
    );
    expect(score).toEqual({ score: 1, reason: "matched" });
  });

  it("combines trim and caseInsensitive", async () => {
    const scorer = ExactMatch.normalizedMatch({ trim: true, caseInsensitive: true });
    const score = await runTest(
      scorer.evaluate({ golden: { expected: "Hello" }, output: "  HELLO  " }),
    );
    expect(score).toEqual({ score: 1, reason: "matched" });
  });

  it("still fails when normalisation isn't enough", async () => {
    const scorer = ExactMatch.normalizedMatch({ trim: true, caseInsensitive: true });
    const score = await runTest(
      scorer.evaluate({ golden: { expected: "Hello" }, output: "Goodbye" }),
    );
    expect(score).toEqual({ score: 0, reason: "mismatched" });
  });

  it("scores 0 when golden has no expected output", async () => {
    const scorer = ExactMatch.normalizedMatch({ trim: true });
    const score = await runTest(scorer.evaluate({ golden: {}, output: "Hello" }));
    expect(score).toEqual({ score: 0, reason: "golden.expected is undefined" });
  });
});
