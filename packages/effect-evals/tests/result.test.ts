/**
 * Unit tests for `Result.summarize` (mean, population variance/stddev, and
 * range over a metric's per-trial scores) and the outcome-explaining /
 * rendering seam (`Result.lastReason`, `Result.formatSpread`) shared by
 * `Reporter.ts` and the CLI — see the drift `Reporter`
 * and a second renderer had before this seam existed:
 * `Result.lastReason`'s fallback text ("" vs "(no reason given)" /
 * "(no trials recorded)") and `Result.formatSpread`'s label style (`μ=`/`σ=`
 * vs `mean=`/`stddev=`) are asserted here as the single canonical form.
 *
 * @module tests/result
 */

import { describe, expect, it } from "vitest";
import { Result } from "../src/index.ts";

const scoredMetric = (score: number, reason?: string): Result.MetricAggregate => ({
  metric: "exact-match",
  passed: score >= 1,
  errorCount: 0,
  summary: Result.summarize([score]),
  trials: [{ _tag: "Scored", trial: 1, cached: false, score: { score, reason } }],
});

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

describe("Result.lastReason", () => {
  it("returns the most recent Scored trial's reason", () => {
    const metric: Result.MetricAggregate = {
      metric: "exact-match",
      passed: true,
      errorCount: 0,
      summary: Result.summarize([0, 1]),
      trials: [
        { _tag: "Scored", trial: 1, cached: false, score: { score: 0, reason: "no match" } },
        { _tag: "Scored", trial: 2, cached: false, score: { score: 1, reason: "exact" } },
      ],
    };
    expect(Result.lastReason(metric)).toBe("exact");
  });

  it("prefers the most recent Scored trial over an earlier Errored trial", () => {
    const metric: Result.MetricAggregate = {
      metric: "exact-match",
      passed: true,
      errorCount: 1,
      summary: Result.summarize([1]),
      trials: [
        { _tag: "Errored", trial: 1, cached: false, error: "judge unavailable" },
        { _tag: "Scored", trial: 2, cached: false, score: { score: 1, reason: "exact" } },
      ],
    };
    expect(Result.lastReason(metric)).toBe("exact");
  });

  it("falls back to the most recent Errored trial's error when no trial scored", () => {
    const metric: Result.MetricAggregate = {
      metric: "exact-match",
      passed: false,
      errorCount: 2,
      summary: undefined,
      trials: [
        { _tag: "Errored", trial: 1, cached: false, error: "first failure" },
        { _tag: "Errored", trial: 2, cached: false, error: "judge unavailable" },
      ],
    };
    expect(Result.lastReason(metric)).toBe("error: judge unavailable");
  });

  // Drift case: `Reporter.ts` used to render "" here, the runner adapter
  // "(no reason given)" — the shared seam picks the latter as canonical.
  it("falls back to a placeholder when the most recent Scored trial gave no reason", () => {
    expect(Result.lastReason(scoredMetric(1))).toBe("(no reason given)");
  });

  // Drift case: neither prior copy agreed on this either — `Reporter.ts`
  // returned "" for an empty trial list, the runner adapter returned
  // "(no trials recorded)"; the shared seam picks the latter as canonical.
  it("falls back to a placeholder when there are no trials at all", () => {
    const metric: Result.MetricAggregate = {
      metric: "exact-match",
      passed: false,
      errorCount: 0,
      summary: undefined,
      trials: [],
    };
    expect(Result.lastReason(metric)).toBe("(no trials recorded)");
  });
});

describe("Result.formatSpread", () => {
  // Drift case: `Reporter.ts` used to render `μ=… σ=…`, the runner adapter
  // `mean=… stddev=…` — the shared seam picks the ASCII form as canonical.
  it("renders mean, stddev, and range with the mean=/stddev= label style", () => {
    const summary = Result.summarize([0.6, 0.8, 1]);
    expect(Result.formatSpread(summary)).toBe(
      `mean=${summary.mean.toFixed(3)} stddev=${summary.stddev.toFixed(3)} [${summary.min.toFixed(3)}, ${summary.max.toFixed(3)}]`,
    );
    expect(Result.formatSpread(summary)).not.toContain("μ=");
    expect(Result.formatSpread(summary)).not.toContain("σ=");
  });

  // Drift case: `Reporter.ts` used to render "—" for an all-errored metric,
  // the runner adapter "no scored trials" — the shared seam picks the
  // latter, more descriptive form as canonical.
  it("falls back to a placeholder when there is no summary", () => {
    expect(Result.formatSpread(undefined)).toBe("no scored trials");
  });
});
