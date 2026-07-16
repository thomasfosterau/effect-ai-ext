/**
 * Unit tests for `Result.summarize` — mean, population variance/stddev, and
 * range over a metric's per-trial scores.
 *
 * @module tests/result
 */

import { describe, expect, it } from "vite-plus/test";
import { Result } from "@thomasfosterau/effect-evals";

describe("Result.summarize", () => {
  it("computes mean, min, and max over the scores", () => {
    const summary = Result.summarize([0.6, 0.8, 1]);
    expect(summary.mean).toBeCloseTo(0.8);
    expect(summary.min).toBe(0.6);
    expect(summary.max).toBe(1);
  });

  it("reports zero variance and stddev for identical scores", () => {
    const summary = Result.summarize([0.5, 0.5, 0.5]);
    expect(summary.variance).toBe(0);
    expect(summary.stddev).toBe(0);
  });

  it("computes population variance and stddev for a single score", () => {
    const summary = Result.summarize([0.9]);
    expect(summary.mean).toBe(0.9);
    expect(summary.variance).toBe(0);
    expect(summary.min).toBe(0.9);
    expect(summary.max).toBe(0.9);
  });

  it("computes population (not sample) variance for spread scores", () => {
    // Population variance of [0, 1]: mean 0.5, squared deviations 0.25 each, / 2 = 0.25.
    const summary = Result.summarize([0, 1]);
    expect(summary.variance).toBeCloseTo(0.25);
    expect(summary.stddev).toBeCloseTo(0.5);
  });
});
