/**
 * Unit tests for the threshold policies (`minScore` / `maxScore` / `strict`).
 *
 * @module tests/threshold
 */

import { describe, expect, it } from "vite-plus/test";
import { Threshold } from "../src/index.ts";
import { unsafeCoerce } from "./helpers/unsafe.ts";

describe("Threshold.minScore", () => {
  const policy = Threshold.minScore(0.7);

  it("passes when the score is at or above the threshold", () => {
    expect(Threshold.passes(policy, 0.7)).toBe(true);
    expect(Threshold.passes(policy, 1)).toBe(true);
  });

  it("fails when the score is below the threshold", () => {
    expect(Threshold.passes(policy, 0.69)).toBe(false);
    expect(Threshold.passes(policy, 0)).toBe(false);
  });
});

describe("Threshold.maxScore", () => {
  const policy = Threshold.maxScore(0.3);

  it("passes when the score is at or below the threshold (lower is better)", () => {
    expect(Threshold.passes(policy, 0.3)).toBe(true);
    expect(Threshold.passes(policy, 0)).toBe(true);
  });

  it("fails when the score is above the threshold", () => {
    expect(Threshold.passes(policy, 0.31)).toBe(false);
    expect(Threshold.passes(policy, 1)).toBe(false);
  });
});

describe("Threshold.strict", () => {
  it("passes only on a perfect score", () => {
    expect(Threshold.passes(Threshold.strict, 1)).toBe(true);
    expect(Threshold.passes(Threshold.strict, 0.999)).toBe(false);
    expect(Threshold.passes(Threshold.strict, 0)).toBe(false);
  });
});

describe("Threshold.describe", () => {
  it("renders minScore as >=", () => {
    expect(Threshold.describe(Threshold.minScore(0.7))).toBe(">= 0.7");
  });

  it("renders maxScore as <=", () => {
    expect(Threshold.describe(Threshold.maxScore(0.3))).toBe("<= 0.3");
  });

  it("renders strict as == 1 (strict)", () => {
    expect(Threshold.describe(Threshold.strict)).toBe("== 1 (strict)");
  });
});

describe("an unknown policy `_tag`", () => {
  // Reachable only from an untyped (type-stripped) eval file. Both functions
  // match exhaustively, so the policy throws (and the run dies) instead of
  // counting as a silent fail or rendering `undefined`.
  const bogus = unsafeCoerce<Threshold.Threshold>({ _tag: "AtLeast", threshold: 0.5 });

  it("makes passes throw", () => {
    expect(() => Threshold.passes(bogus, 1)).toThrow("effect/match/Match/exhaustive: absurd");
  });

  it("makes describe throw", () => {
    expect(() => Threshold.describe(bogus)).toThrow("effect/match/Match/exhaustive: absurd");
  });
});
