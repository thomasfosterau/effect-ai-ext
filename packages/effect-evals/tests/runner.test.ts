/**
 * Unit tests for `Runner.runSuite`: end-to-end execution against a stubbed
 * task/scorer, N-trial aggregation, retry-on-retryable-`AiError`,
 * content-hash caching (zero model calls on a repeat run), and the
 * ignore-vs-fail metric-error semantics.
 *
 * @module tests/runner
 */

import { describe, expect, it } from "vitest";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { AiError } from "effect/unstable/ai";
import { Cache, Dataset, Metric, Runner, Scorer, Threshold } from "../src/index.ts";
import { runTest } from "./helpers/effect.ts";

class TaskError {
  readonly _tag = "TaskError";
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

/** Immediate retries (no delay) so retry tests stay fast. */
const fastSchedule = Schedule.recurs(5);

const exactMatchMetric = Metric.makeMetric({
  name: "exact-match",
  scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
    name: "exact-match",
    evaluate: (evalCase) => Effect.succeed({ score: evalCase.golden === evalCase.output ? 1 : 0 }),
  }),
  threshold: Threshold.strict,
});

const echoTask = Runner.makeTask<string, string>({
  id: "echo@v1",
  run: (golden) => Effect.succeed(golden),
});

describe("Runner.runSuite — end to end", () => {
  it("runs every golden through the task and every metric, bounded concurrency", async () => {
    const suite = Runner.makeSuite({
      name: "greetings",
      dataset: Dataset.fromArray("greetings", ["Bonjour", "Ciao"]),
      task: echoTask,
      metrics: [exactMatchMetric],
    });

    const result = await runTest(Runner.runSuite(suite).pipe(Effect.provide(Cache.layerMemory)));

    expect(result.suite).toBe("greetings");
    expect(result.passed).toBe(true);
    expect(result.cases).toHaveLength(2);
    expect(result.cases[0]?.metrics[0]?.summary?.mean).toBe(1);
    expect(result.cases[0]?.metrics[0]?.passed).toBe(true);
  });

  it("fails the case when the metric's score misses its threshold", async () => {
    const suite = Runner.makeSuite({
      name: "mismatches",
      dataset: Dataset.fromArray("mismatches", ["Bonjour"]),
      task: Runner.makeTask<string, string>({
        id: "shout@v1",
        run: (g) => Effect.succeed(g.toUpperCase()),
      }),
      metrics: [exactMatchMetric],
    });

    const result = await runTest(Runner.runSuite(suite).pipe(Effect.provide(Cache.layerMemory)));

    expect(result.passed).toBe(false);
    expect(result.cases[0]?.metrics[0]?.passed).toBe(false);
    expect(result.cases[0]?.metrics[0]?.summary?.mean).toBe(0);
  });

  it("propagates a dataset failure rather than swallowing it", async () => {
    class DatasetError {
      readonly _tag = "DatasetError";
    }
    const suite = Runner.makeSuite({
      name: "broken",
      dataset: Dataset.makeDataset<string, DatasetError>({
        name: "broken",
        goldens: Effect.fail(new DatasetError()),
      }),
      task: echoTask,
      metrics: [exactMatchMetric],
    });

    await expect(
      runTest(Runner.runSuite(suite).pipe(Effect.provide(Cache.layerMemory))),
    ).rejects.toThrow();
  });
});

describe("Runner.runSuite — trials", () => {
  it("aggregates mean/variance/min/max and exposes every per-trial score", async () => {
    const scores = [0.6, 0.8, 1];
    let call = 0;
    const varyingMetric = Metric.makeMetric({
      name: "varying",
      scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
        name: "varying",
        evaluate: () => Effect.sync(() => ({ score: scores[call++] ?? 1 })),
      }),
      threshold: Threshold.minScore(0.5),
    });

    const suite = Runner.makeSuite({
      name: "trials",
      dataset: Dataset.fromArray("trials", ["Bonjour"]),
      task: echoTask,
      metrics: [varyingMetric],
    });

    const result = await runTest(
      Runner.runSuite(suite, { trials: 3 }).pipe(Effect.provide(Cache.layerMemory)),
    );

    const metric = result.cases[0]?.metrics[0];
    expect(metric?.trials).toHaveLength(3);
    expect(metric?.summary?.mean).toBeCloseTo(0.8);
    expect(metric?.summary?.min).toBe(0.6);
    expect(metric?.summary?.max).toBe(1);
    expect(metric?.passed).toBe(true);
  });

  it("clamps a non-positive trials option to 1 instead of running zero trials", async () => {
    let taskCalls = 0;
    const suite = Runner.makeSuite({
      name: "clamped",
      dataset: Dataset.fromArray("clamped", ["Bonjour"]),
      task: Runner.makeTask<string, string>({
        id: "counting@v1",
        run: (golden) =>
          Effect.sync(() => {
            taskCalls++;
            return golden;
          }),
      }),
      metrics: [exactMatchMetric],
    });

    const result = await runTest(
      Runner.runSuite(suite, { trials: 0 }).pipe(Effect.provide(Cache.layerMemory)),
    );

    // trials: 0 doesn't mean "skip the case" — it's clamped to the minimum
    // meaningful value (1), and the reported trial count matches what ran.
    expect(taskCalls).toBe(1);
    expect(result.cases[0]?.trials).toBe(1);
    expect(result.cases[0]?.metrics[0]?.trials).toHaveLength(1);
  });
});

describe("Runner.runSuite — retry", () => {
  it("retries a retryable AiError and eventually succeeds", async () => {
    let attempts = 0;
    const flakyMetric = Metric.makeMetric({
      name: "flaky",
      scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>, AiError.AiError>({
        name: "flaky",
        evaluate: () =>
          Effect.gen(function* () {
            attempts++;
            if (attempts < 3) {
              return yield* AiError.make({
                module: "test",
                method: "flaky",
                reason: new AiError.RateLimitError({}),
              });
            }
            return { score: 1 };
          }),
      }),
      threshold: Threshold.strict,
    });

    const suite = Runner.makeSuite({
      name: "retry",
      dataset: Dataset.fromArray("retry", ["Bonjour"]),
      task: echoTask,
      metrics: [flakyMetric],
    });

    const result = await runTest(
      Runner.runSuite(suite, { metricRetrySchedule: fastSchedule }).pipe(
        Effect.provide(Cache.layerMemory),
      ),
    );

    expect(attempts).toBe(3);
    expect(result.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ _tag: "Scored" });
    expect(result.cases[0]?.metrics[0]?.passed).toBe(true);
  });

  it("does not retry a non-retryable AiError, surfacing it as an Errored trial", async () => {
    let attempts = 0;
    const authFailingMetric = Metric.makeMetric({
      name: "auth-failing",
      scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>, AiError.AiError>({
        name: "auth-failing",
        evaluate: () =>
          Effect.gen(function* () {
            attempts++;
            return yield* AiError.make({
              module: "test",
              method: "authFailing",
              reason: new AiError.AuthenticationError({ kind: "InvalidKey" }),
            });
          }),
      }),
      threshold: Threshold.strict,
    });

    const suite = Runner.makeSuite({
      name: "no-retry",
      dataset: Dataset.fromArray("no-retry", ["Bonjour"]),
      task: echoTask,
      metrics: [authFailingMetric],
    });

    const result = await runTest(
      Runner.runSuite(suite, { metricRetrySchedule: fastSchedule }).pipe(
        Effect.provide(Cache.layerMemory),
      ),
    );

    expect(attempts).toBe(1);
    expect(result.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ _tag: "Errored" });
    expect(result.cases[0]?.metrics[0]?.errorCount).toBe(1);
  });

  it("does not retry the task when its error is not an AiError", async () => {
    let attempts = 0;
    const suite = Runner.makeSuite({
      name: "task-error",
      dataset: Dataset.fromArray("task-error", ["Bonjour"]),
      task: Runner.makeTask<string, string, TaskError>({
        id: "always-fails@v1",
        run: () =>
          Effect.sync(() => {
            attempts++;
          }).pipe(Effect.flatMap(() => Effect.fail(new TaskError("boom")))),
      }),
      metrics: [exactMatchMetric],
    });

    const result = await runTest(
      Runner.runSuite(suite, { taskRetrySchedule: fastSchedule }).pipe(
        Effect.provide(Cache.layerMemory),
      ),
    );

    expect(attempts).toBe(1);
    expect(result.cases[0]?.taskFailures).toHaveLength(1);
    expect(result.cases[0]?.metrics[0]?.trials).toHaveLength(0);
    expect(result.cases[0]?.passed).toBe(false);
  });
});

describe("Runner.runSuite — ignore vs fail metric errors", () => {
  const makeFlakyOnceMetric = () => {
    let call = 0;
    return Metric.makeMetric({
      name: "flaky-once",
      scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>, TaskError>({
        name: "flaky-once",
        evaluate: () =>
          Effect.gen(function* () {
            call++;
            if (call === 1) return yield* Effect.fail(new TaskError("first trial fails"));
            return { score: 1 };
          }),
      }),
      threshold: Threshold.strict,
    });
  };

  it("fails the case on any metric error by default (ignoreErrors: false)", async () => {
    const suite = Runner.makeSuite({
      name: "strict-errors",
      dataset: Dataset.fromArray("strict-errors", ["Bonjour"]),
      task: echoTask,
      metrics: [makeFlakyOnceMetric()],
    });

    const result = await runTest(
      Runner.runSuite(suite, { trials: 3 }).pipe(Effect.provide(Cache.layerMemory)),
    );

    expect(result.cases[0]?.metrics[0]?.errorCount).toBe(1);
    expect(result.cases[0]?.metrics[0]?.passed).toBe(false);
    expect(result.cases[0]?.passed).toBe(false);
  });

  it("excludes errored trials from the aggregate when ignoreErrors: true", async () => {
    const suite = Runner.makeSuite({
      name: "ignored-errors",
      dataset: Dataset.fromArray("ignored-errors", ["Bonjour"]),
      task: echoTask,
      metrics: [makeFlakyOnceMetric()],
    });

    const result = await runTest(
      Runner.runSuite(suite, { trials: 3, ignoreErrors: true }).pipe(
        Effect.provide(Cache.layerMemory),
      ),
    );

    const metric = result.cases[0]?.metrics[0];
    expect(metric?.errorCount).toBe(1);
    expect(metric?.summary?.mean).toBe(1);
    expect(metric?.passed).toBe(true);
    expect(result.cases[0]?.passed).toBe(true);
  });
});

describe("Runner.runSuite — caching", () => {
  it("makes zero further scorer/task calls on a repeat run against the same cache", async () => {
    let taskCalls = 0;
    let metricCalls = 0;

    const countingTask = Runner.makeTask<string, string>({
      id: "counting@v1",
      run: (golden) =>
        Effect.sync(() => {
          taskCalls++;
          return golden;
        }),
    });
    const countingMetric = Metric.makeMetric({
      name: "counting",
      scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
        name: "counting",
        evaluate: () =>
          Effect.sync(() => {
            metricCalls++;
            return { score: 1 };
          }),
      }),
      threshold: Threshold.strict,
    });

    const suite = Runner.makeSuite({
      name: "cached",
      dataset: Dataset.fromArray("cached", ["Bonjour"]),
      task: countingTask,
      metrics: [countingMetric],
    });

    const [first, second] = await runTest(
      Effect.gen(function* () {
        const r1 = yield* Runner.runSuite(suite);
        const r2 = yield* Runner.runSuite(suite);
        return [r1, r2] as const;
      }).pipe(Effect.provide(Cache.layerMemory)),
    );

    expect(taskCalls).toBe(1);
    expect(metricCalls).toBe(1);
    expect(first?.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ cached: false });
    expect(second?.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ cached: true });
    expect(second?.passed).toBe(true);
  });

  it("bypassCache: true skips the cache, making a fresh call on every run", async () => {
    let metricCalls = 0;
    const countingMetric = Metric.makeMetric({
      name: "counting",
      scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
        name: "counting",
        evaluate: () =>
          Effect.sync(() => {
            metricCalls++;
            return { score: 1 };
          }),
      }),
      threshold: Threshold.strict,
    });

    const suite = Runner.makeSuite({
      name: "bypassed",
      dataset: Dataset.fromArray("bypassed", ["Bonjour"]),
      task: echoTask,
      metrics: [countingMetric],
    });

    await runTest(
      Effect.gen(function* () {
        yield* Runner.runSuite(suite, { bypassCache: true });
        yield* Runner.runSuite(suite, { bypassCache: true });
      }).pipe(Effect.provide(Cache.layerMemory)),
    );

    expect(metricCalls).toBe(2);
  });
});

describe("Runner.makeSuite — heterogeneous metrics", () => {
  class ErrorA {
    readonly _tag = "ErrorA";
  }
  class ErrorB {
    readonly _tag = "ErrorB";
  }
  class ServiceA extends Context.Service<
    ServiceA,
    { readonly rate: () => Effect.Effect<number, ErrorA> }
  >()("tests/Runner/ServiceA") {}
  class ServiceB extends Context.Service<
    ServiceB,
    { readonly rate: () => Effect.Effect<number, ErrorB> }
  >()("tests/Runner/ServiceB") {}

  const metricA = Metric.makeMetric({
    name: "metric-a",
    scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>, ErrorA, ServiceA>({
      name: "metric-a",
      evaluate: () =>
        Effect.gen(function* () {
          const service = yield* ServiceA;
          return { score: yield* service.rate() };
        }),
    }),
    threshold: Threshold.strict,
  });

  const metricB = Metric.makeMetric({
    name: "metric-b",
    scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>, ErrorB, ServiceB>({
      name: "metric-b",
      evaluate: () =>
        Effect.gen(function* () {
          const service = yield* ServiceB;
          return { score: yield* service.rate() };
        }),
    }),
    threshold: Threshold.strict,
  });

  it("infers the union of E/R across metrics with different E/R, no explicit array annotation", async () => {
    // No explicit `ReadonlyArray<Metric.Metric<..., ErrorA | ErrorB, ServiceA | ServiceB>>` annotation
    // here — `makeSuite`'s `const Metrics` type parameter infers the tuple and unions MetricE/MetricR
    // from `metricA`/`metricB` directly; a regression here would fail `vp run check`, not this assertion.
    const suite = Runner.makeSuite({
      name: "heterogeneous",
      dataset: Dataset.fromArray("heterogeneous", ["Bonjour"]),
      task: echoTask,
      metrics: [metricA, metricB],
    });

    const layer = Layer.mergeAll(
      Layer.succeed(ServiceA, { rate: () => Effect.succeed(1) }),
      Layer.succeed(ServiceB, { rate: () => Effect.succeed(1) }),
    );

    const result = await runTest(
      Runner.runSuite(suite).pipe(Effect.provide(Layer.merge(Cache.layerMemory, layer))),
    );

    expect(result.passed).toBe(true);
    expect(result.cases[0]?.metrics.map((metric) => metric.metric).sort()).toEqual([
      "metric-a",
      "metric-b",
    ]);
  });
});

describe("Runner.runSuite — reporters", () => {
  it("invokes every reporter exactly once with the final result", async () => {
    const reports: Array<string> = [];
    const suite = Runner.makeSuite({
      name: "reported",
      dataset: Dataset.fromArray("reported", ["Bonjour"]),
      task: echoTask,
      metrics: [exactMatchMetric],
    });

    await runTest(
      Runner.runSuite(suite, {
        reporters: [
          {
            name: "spy-a",
            report: (result) => Effect.sync(() => void reports.push(`a:${result.suite}`)),
          },
          {
            name: "spy-b",
            report: (result) => Effect.sync(() => void reports.push(`b:${result.suite}`)),
          },
        ],
      }).pipe(Effect.provide(Cache.layerMemory)),
    );

    expect(reports.sort()).toEqual(["a:reported", "b:reported"]);
  });
});

describe("Runner.isConfigError", () => {
  it("identifies a real Config.ConfigError", async () => {
    const error = await runTest(
      Config.string("EFFECT_EVALS_RUNNER_TEST_MISSING_CONFIG").pipe(Effect.flip),
    );
    expect(Runner.isConfigError(error)).toBe(true);
  });

  it("rejects errors that aren't a Config.ConfigError", () => {
    expect(Runner.isConfigError(new Error("boom"))).toBe(false);
    expect(Runner.isConfigError("boom")).toBe(false);
    expect(Runner.isConfigError(undefined)).toBe(false);
  });
});
