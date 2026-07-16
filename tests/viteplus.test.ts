/**
 * Self-test for the `./viteplus` adapter (#929): `evaluateSuite`'s three
 * outcomes (Ran-passing, Ran-failing, Skipped-on-`Config.ConfigError`, and
 * Errored-on-anything-else), `formatCaseFailure`'s message content, and
 * `caseLabel`'s golden-input labelling. The bottom of the file also dogfeeds
 * the real `defineEval` against fixtures that are safe to run in CI — one
 * passing suite and one credential-gated suite — proving the real
 * `describe`/`it` wiring end to end without ever registering a genuinely
 * failing test in this package's own unit suite (a deliberately *failing*
 * fixture is only ever driven through `evaluateSuite`/`formatCaseFailure`
 * directly, never through `defineEval`).
 *
 * @module tests/viteplus
 */

import { describe, expect, it } from "vite-plus/test";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  Cache,
  Dataset,
  Metric,
  Result,
  Runner,
  Scorer,
  Threshold,
} from "@thomasfosterau/effect-evals";
import {
  caseLabel,
  defineEval,
  evaluateEvalFile,
  evaluateSuite,
  formatCaseFailure,
} from "@thomasfosterau/effect-evals/viteplus";
import { runTest } from "@test-helpers/effect";

const echoTask = Runner.makeTask<string, string>({
  id: "echo@v1",
  run: (golden) => Effect.succeed(golden),
});

const shoutTask = Runner.makeTask<string, string>({
  id: "shout@v1",
  run: (golden) => Effect.succeed(golden.toUpperCase()),
});

const exactMatchMetric = Metric.makeMetric({
  name: "exact-match",
  scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
    name: "exact-match",
    evaluate: (evalCase) => Effect.succeed({ score: evalCase.golden === evalCase.output ? 1 : 0 }),
  }),
  threshold: Threshold.strict,
});

const passingSuite = Runner.makeSuite({
  name: "viteplus adapter — passing",
  dataset: Dataset.fromArray("greetings", ["Bonjour"]),
  task: echoTask,
  metrics: [exactMatchMetric],
});

const failingSuite = Runner.makeSuite({
  name: "viteplus adapter — failing",
  dataset: Dataset.fromArray("mismatches", ["Bonjour"]),
  task: shoutTask,
  metrics: [exactMatchMetric],
});

const MISSING_CONFIG_KEY = "EFFECT_EVALS_VITEPLUS_TEST_MISSING_CONFIG";

const skipLayer = Layer.merge(
  Cache.layerMemory,
  Layer.effectDiscard(Config.string(MISSING_CONFIG_KEY)),
);

describe("viteplus.evaluateSuite", () => {
  it("returns a Ran outcome with the suite's result when every case passes", async () => {
    const outcome = await runTest(
      evaluateSuite({ suites: [passingSuite], layer: Cache.layerMemory }, passingSuite),
    );

    expect(outcome._tag).toBe("Ran");
    if (outcome._tag !== "Ran") throw new Error("expected Ran");
    expect(outcome.suite).toBe(passingSuite.name);
    expect(outcome.result.passed).toBe(true);
  });

  it("returns a Ran outcome with passed: false when a case misses its threshold", async () => {
    const outcome = await runTest(
      evaluateSuite({ suites: [failingSuite], layer: Cache.layerMemory }, failingSuite),
    );

    expect(outcome._tag).toBe("Ran");
    if (outcome._tag !== "Ran") throw new Error("expected Ran");
    expect(outcome.result.passed).toBe(false);
    expect(outcome.result.cases[0]?.passed).toBe(false);
  });

  it("returns Skipped naming the missing config when the layer fails with a Config.ConfigError", async () => {
    const outcome = await runTest(
      evaluateSuite({ suites: [passingSuite], layer: skipLayer }, passingSuite),
    );

    expect(outcome._tag).toBe("Skipped");
    if (outcome._tag !== "Skipped") throw new Error("expected Skipped");
    expect(outcome.message).toContain(MISSING_CONFIG_KEY);
  });

  it("returns Errored (not Skipped) for a non-config failure", async () => {
    class BrokenDatasetError {
      readonly _tag = "BrokenDatasetError";
    }
    const brokenSuite = Runner.makeSuite({
      name: "viteplus adapter — broken dataset",
      dataset: Dataset.makeDataset({
        name: "broken",
        goldens: Effect.fail(new BrokenDatasetError()),
      }),
      task: echoTask,
      metrics: [exactMatchMetric],
    });

    const outcome = await runTest(
      evaluateSuite({ suites: [brokenSuite], layer: Cache.layerMemory }, brokenSuite),
    );

    expect(outcome._tag).toBe("Errored");
    if (outcome._tag !== "Errored") throw new Error("expected Errored");
    expect(outcome.message).toContain("BrokenDatasetError");
  });
});

describe("viteplus.evaluateEvalFile", () => {
  it("runs every suite concurrently against one shared build of the layer", async () => {
    let layerBuilds = 0;
    const countingLayer = Layer.merge(
      Cache.layerMemory,
      Layer.effectDiscard(Effect.sync(() => void layerBuilds++)),
    );

    const outcomes = await runTest(
      evaluateEvalFile({ suites: [passingSuite, failingSuite], layer: countingLayer }),
    );

    expect(layerBuilds).toBe(1);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ _tag: "Ran", suite: passingSuite.name });
    expect(outcomes[1]).toMatchObject({ _tag: "Ran", suite: failingSuite.name });
    if (outcomes[0]?._tag !== "Ran" || outcomes[1]?._tag !== "Ran") throw new Error("expected Ran");
    expect(outcomes[0].result.passed).toBe(true);
    expect(outcomes[1].result.passed).toBe(false);
  });

  it("skips every suite in the file when the shared layer fails with a Config.ConfigError", async () => {
    const outcomes = await runTest(
      evaluateEvalFile({ suites: [passingSuite, failingSuite], layer: skipLayer }),
    );

    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome._tag).toBe("Skipped");
      if (outcome._tag !== "Skipped") throw new Error("expected Skipped");
      expect(outcome.message).toContain(MISSING_CONFIG_KEY);
    }
  });

  it("reports zero cases for a suite whose dataset is empty", async () => {
    const emptySuite = Runner.makeSuite({
      name: "viteplus adapter — empty dataset",
      dataset: Dataset.fromArray("empty", []),
      task: echoTask,
      metrics: [exactMatchMetric],
    });

    const [outcome] = await runTest(
      evaluateEvalFile({ suites: [emptySuite], layer: Cache.layerMemory }),
    );

    expect(outcome?._tag).toBe("Ran");
    if (outcome?._tag !== "Ran") throw new Error("expected Ran");
    expect(outcome.result.cases).toHaveLength(0);
  });
});

describe("viteplus.formatCaseFailure", () => {
  const minScoreMetric = Metric.makeMetric({
    name: "min-score-metric",
    scorer: exactMatchMetric.scorer,
    threshold: Threshold.minScore(0.9),
  });
  const maxScoreMetric = Metric.makeMetric({
    name: "max-score-metric",
    scorer: exactMatchMetric.scorer,
    threshold: Threshold.maxScore(0.1),
  });
  const thresholdSuite = Runner.makeSuite({
    name: "viteplus adapter — threshold fixtures",
    dataset: Dataset.fromArray("fixtures", ["Bonjour"]),
    task: echoTask,
    metrics: [exactMatchMetric, minScoreMetric, maxScoreMetric],
  });

  it("surfaces a strict metric's name, threshold, judge reason, and trial spread", () => {
    const caseResult: Result.CaseResult<string> = {
      golden: "Bonjour",
      trials: 2,
      passed: false,
      taskFailures: [],
      metrics: [
        {
          metric: "exact-match",
          passed: false,
          errorCount: 0,
          summary: { mean: 0.5, variance: 0.25, stddev: 0.5, min: 0, max: 1 },
          trials: [
            { _tag: "Scored", trial: 1, cached: false, score: { score: 0, reason: "no match" } },
            { _tag: "Scored", trial: 2, cached: false, score: { score: 1, reason: "exact" } },
          ],
        },
      ],
    };

    const message = formatCaseFailure(caseResult, thresholdSuite);

    expect(message).toContain('metric "exact-match"');
    expect(message).toContain("== 1 (strict)");
    expect(message).toContain("mean=0.500");
    expect(message).toContain("exact"); // the most recent scored trial's reason
  });

  it("describes a min-score threshold as >= and a max-score threshold as <=", () => {
    const makeFailingMetric = (metric: string): Result.MetricAggregate => ({
      metric,
      passed: false,
      errorCount: 0,
      summary: { mean: 0.5, variance: 0, stddev: 0, min: 0.5, max: 0.5 },
      trials: [{ _tag: "Scored", trial: 1, cached: false, score: { score: 0.5 } }],
    });
    const caseResult: Result.CaseResult<string> = {
      golden: "Bonjour",
      trials: 1,
      passed: false,
      taskFailures: [],
      metrics: [makeFailingMetric("min-score-metric"), makeFailingMetric("max-score-metric")],
    };

    const message = formatCaseFailure(caseResult, thresholdSuite);

    expect(message).toContain(">= 0.9");
    expect(message).toContain("<= 0.1");
  });

  it("surfaces the last error when every trial errored, and the errored-trial count", () => {
    const caseResult: Result.CaseResult<string> = {
      golden: "Bonjour",
      trials: 1,
      passed: false,
      taskFailures: [],
      metrics: [
        {
          metric: "exact-match",
          passed: false,
          errorCount: 1,
          summary: undefined,
          trials: [{ _tag: "Errored", trial: 1, cached: false, error: "judge unavailable" }],
        },
      ],
    };

    const message = formatCaseFailure(caseResult, thresholdSuite);

    expect(message).toContain("no scored trials");
    expect(message).toContain("1 errored trial");
    expect(message).toContain("error: judge unavailable");
  });

  it("surfaces task failures", () => {
    const caseResult: Result.CaseResult<string> = {
      golden: "Bonjour",
      trials: 1,
      passed: false,
      taskFailures: [{ trial: 1, error: "boom" }],
      metrics: [],
    };

    expect(formatCaseFailure(caseResult, thresholdSuite)).toContain("task failed on trial 1: boom");
  });

  it("falls back to a generic message when nothing recorded explains the failure", () => {
    const caseResult: Result.CaseResult<string> = {
      golden: "Bonjour",
      trials: 1,
      passed: false,
      taskFailures: [],
      metrics: [],
    };

    expect(formatCaseFailure(caseResult, thresholdSuite)).toContain("no recorded task failures");
  });
});

describe("viteplus.caseLabel", () => {
  it("labels a case by its golden's string input, truncated past 60 characters", () => {
    expect(caseLabel({ input: "Bonjour" }, 0)).toBe("[0] Bonjour");
    expect(caseLabel({ input: "x".repeat(80) }, 1)).toBe(`[1] ${"x".repeat(57)}...`);
  });

  it("falls back to the index when the golden has no string input", () => {
    expect(caseLabel({ input: 42 }, 2)).toBe("case 2");
    expect(caseLabel("Bonjour", 3)).toBe("case 3");
  });
});

// ── Real registration (dogfeeds `defineEval` — see module docs) ─────────

defineEval({ suites: [passingSuite], layer: Cache.layerMemory });

defineEval({
  suites: [
    Runner.makeSuite({
      name: "viteplus adapter — skipped (missing config)",
      dataset: Dataset.fromArray("skip", ["Bonjour"]),
      task: echoTask,
      metrics: [exactMatchMetric],
    }),
  ],
  layer: skipLayer,
});
