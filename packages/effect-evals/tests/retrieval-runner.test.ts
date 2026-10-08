/**
 * Unit tests for `Runner.runRetrievalSuite` and `Result.aggregate` — and
 * the demonstration that a deterministic offline mode is real: every
 * assertion below drives the **whole** runner with no database, no gateway
 * and no credential, through the same `RetrievalPort` seam a credentialed
 * invocation uses.
 *
 * The stand-in port is deterministic by construction (a fixed map from
 * query to ordering), which is why a spec over ranking is not flaky. The
 * cases are gardeneria's `packages/evaluation` `runner.test.ts`, the
 * behavioural spec this runner entry was ported from.
 *
 * @module tests/retrieval-runner
 */

import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Effect from "effect/Effect";
import { Cache, Dataset, Result, Runner, Threshold } from "../src/index.ts";
import { runTest } from "./helpers/effect.ts";

const goldens: ReadonlyArray<Runner.RetrievalGolden> = [
  { name: "exact", query: "monstera deliciosa", relevant: { "taxon:monstera-deliciosa": 3 } },
  {
    name: "genus",
    query: "monstera",
    relevant: { "taxon:monstera": 3, "taxon:monstera-x": 1 },
  },
];
const dataset = Dataset.fromArray("fixture", goldens);

/**
 * A port over a fixed query → ordering map. A query it does not know fails,
 * which is how the failure paths below are staged.
 */
const stubPort = (
  orderings: Record<string, ReadonlyArray<string>>,
  id = "stub@none",
): Runner.RetrievalPort<string> => ({
  id,
  retrieve: (query) => {
    const ranked = orderings[query];
    return ranked === undefined
      ? Effect.fail(`no stubbed ordering for "${query}"`)
      : Effect.succeed(ranked);
  },
});

const ideal = stubPort({
  "monstera deliciosa": ["taxon:monstera-deliciosa"],
  monstera: ["taxon:monstera", "taxon:monstera-x"],
});

const run = (
  suite: Partial<Runner.RetrievalSuite<never, never, string, never>> = {},
  options: Runner.RunnerOptions = {},
) =>
  runTest(
    Runner.runRetrievalSuite(
      { name: "fixture", dataset, port: ideal, k: 3, ...suite },
      { bypassCache: true, ...options },
    ).pipe(Effect.provide(Cache.layerMemory)),
  );

describe("Runner.runRetrievalSuite", () => {
  it("scores a perfect run 1 on every metric it computes", async () => {
    const result = await run();
    expect(result.passed).toBe(true);
    expect(result.aggregate.metrics["ndcg@3"]).toEqual({ mean: 1, cases: 2 });
    expect(result.aggregate.metrics["recall@3"]).toEqual({ mean: 1, cases: 2 });
    expect(result.aggregate.metrics["mrr@3"]).toEqual({ mean: 1, cases: 2 });
    expect(result.aggregate).toMatchObject({ totalCases: 2, successfulCases: 2, failedCases: 0 });
    expect(result.suite).toBe("fixture");
  });

  it("records one result per case, in the dataset's declared order, with the golden as-is", async () => {
    const result = await run();
    expect(result.cases.map((caseResult) => caseResult.golden.name)).toEqual(["exact", "genus"]);
    expect(result.cases[1]?.golden).toBe(goldens[1]);
  });

  it("names every metric by its cutoff and scores only the metrics it was given", async () => {
    const result = await run({ k: 10, metrics: { metrics: ["recall", "ndcg"] } });
    expect(result.cases[0]?.metrics.map((metric) => metric.metric)).toEqual([
      "recall@10",
      "ndcg@10",
    ]);
    expect(Arr.sort(Object.keys(result.aggregate.metrics), Order.String)).toEqual([
      "ndcg@10",
      "recall@10",
    ]);
  });

  it("passes the page size to the port and truncates a port that over-returns", async () => {
    const limits: number[] = [];
    const overReturning: Runner.RetrievalPort<string> = {
      id: "over@none",
      retrieve: (query, { limit }) => {
        limits.push(limit);
        return ideal
          .retrieve(query, { limit })
          .pipe(Effect.map((ranked) => [...ranked, "x", "y", "z"]));
      },
    };
    const result = await run({ port: overReturning, k: 1 });
    expect(limits).toEqual([1, 1]);
    // precision@1 over the truncated page: 1 of 1, not 1 of 4.
    expect(result.aggregate.metrics["precision@1"]).toEqual({ mean: 1, cases: 2 });
    // The second case's page holds only "taxon:monstera" — recall 0.5.
    expect(result.cases[1]?.metrics.find((m) => m.metric === "recall@1")?.summary?.mean).toBe(0.5);
  });

  it("records a failed query, keeps going, and excludes it from the means", async () => {
    // Only the second case is stubbed, so the first fails.
    const result = await run({
      port: stubPort({ monstera: ["taxon:monstera", "taxon:monstera-x"] }),
    });
    expect(result.cases[0]?.taskFailures).toEqual([
      { trial: 1, error: 'no stubbed ordering for "monstera deliciosa"' },
    ]);
    expect(result.cases[0]?.passed).toBe(false);
    expect(result.cases[0]?.metrics.every((metric) => metric.summary === undefined)).toBe(true);
    // The surviving case scored 1, and the failure did not drag it to 0.5.
    expect(result.aggregate.metrics["ndcg@3"]).toEqual({ mean: 1, cases: 1 });
    expect(result.aggregate).toMatchObject({ totalCases: 2, successfulCases: 1, failedCases: 1 });
  });

  it("has an empty aggregate and fails when every query failed, rather than a page of zeros", async () => {
    const result = await run({ port: stubPort({}) });
    expect(result.passed).toBe(false);
    expect(result.aggregate.metrics).toEqual({});
    expect(result.aggregate).toMatchObject({ totalCases: 2, successfulCases: 0, failedCases: 2 });
  });

  it("applies per-metric thresholds when given, and never fails a case otherwise", async () => {
    const swapped = stubPort({
      "monstera deliciosa": ["taxon:monstera-deliciosa"],
      monstera: ["taxon:monstera-x", "taxon:monstera"],
    });
    const lenient = await run({ port: swapped });
    expect(lenient.passed).toBe(true);
    expect(lenient.aggregate.metrics["ndcg@3"]?.mean).toBeLessThan(1);

    const gated = await run({
      port: swapped,
      metrics: { thresholds: { ndcg: Threshold.minScore(0.99) } },
    });
    expect(gated.passed).toBe(false);
    expect(gated.cases[1]?.metrics.find((m) => m.metric === "ndcg@3")?.passed).toBe(false);
    expect(gated.cases[1]?.metrics.find((m) => m.metric === "recall@3")?.passed).toBe(true);
  });

  it("runs cases sequentially by default and lets the caller raise concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const counting: Runner.RetrievalPort<string> = {
      id: "counting@none",
      retrieve: (query, options) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
          }),
          () => ideal.retrieve(query, options).pipe(Effect.delay("5 millis")),
          () => Effect.sync(() => void (inFlight -= 1)),
        ),
    };
    await run({ port: counting });
    expect(maxInFlight).toBe(1);

    maxInFlight = 0;
    await run({ port: counting }, { caseConcurrency: 2 });
    expect(maxInFlight).toBe(2);
  });

  it("keys the result cache on the port id and cutoff, so a repeat run makes no retrieval calls", async () => {
    let calls = 0;
    const counting: Runner.RetrievalPort<string> = {
      id: "search@rerank-v3.5",
      retrieve: (query, options) => {
        calls += 1;
        return ideal.retrieve(query, options);
      },
    };
    const suite = { name: "f", dataset, port: counting, k: 3 };
    const [first, second, other] = await runTest(
      Effect.gen(function* () {
        const first = yield* Runner.runRetrievalSuite(suite);
        const second = yield* Runner.runRetrievalSuite(suite);
        // A different cutoff is a different measurement — its own cache key.
        const other = yield* Runner.runRetrievalSuite({ ...suite, k: 5 });
        return [first, second, other] as const;
      }).pipe(Effect.provide(Cache.layerMemory)),
    );
    expect(calls).toBe(4);
    expect(second.aggregate).toEqual(first.aggregate);
    expect(second.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ cached: true });
    expect(other.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ cached: false });
  });

  it("is deterministic: the same dataset and port produce the same scores", async () => {
    const first = await run();
    const second = await run();
    expect(second.aggregate).toEqual(first.aggregate);
  });
});

describe("Result.aggregate", () => {
  const scored = (metric: string, mean: number): Result.MetricAggregate => ({
    metric,
    trials: [{ _tag: "Scored", trial: 1, score: { score: mean }, cached: false }],
    summary: Result.summarize([mean]),
    errorCount: 0,
    passed: true,
  });
  const errored = (metric: string): Result.MetricAggregate => ({
    metric,
    trials: [{ _tag: "Errored", trial: 1, error: "boom", cached: false }],
    summary: undefined,
    errorCount: 1,
    passed: false,
  });
  const caseResult = (
    metrics: ReadonlyArray<Result.MetricAggregate>,
    taskFailures: ReadonlyArray<Result.TaskTrialFailure> = [],
  ): Result.CaseResult => ({ golden: {}, trials: 1, taskFailures, metrics, passed: true });
  const suite = (cases: ReadonlyArray<Result.CaseResult>): Result.SuiteResult => ({
    suite: "s",
    cases,
    passed: true,
    durationMillis: 0,
  });

  it("means over the cases that scored only — a failed case is never a zero", () => {
    const aggregate = Result.aggregate(
      suite([
        caseResult([scored("ndcg@5", 1)]),
        caseResult([scored("ndcg@5", 0.5)]),
        // If this contributed a 0 the mean would be 0.5, and a broken
        // provider would read as a quality regression.
        caseResult([errored("ndcg@5")], [{ trial: 1, error: "gateway down" }]),
      ]),
    );
    expect(aggregate.metrics).toEqual({ "ndcg@5": { mean: 0.75, cases: 2 } });
    expect(aggregate).toMatchObject({ totalCases: 3, successfulCases: 2, failedCases: 1 });
  });

  it("returns an empty aggregate rather than NaN when every case failed", () => {
    const aggregate = Result.aggregate(
      suite([caseResult([errored("ndcg@5")], [{ trial: 1, error: "boom" }])]),
    );
    expect(aggregate.metrics).toEqual({});
    expect(aggregate.successfulCases).toBe(0);
  });

  it("aggregates an empty suite without dividing by zero", () => {
    expect(Result.aggregate(suite([]))).toEqual({
      metrics: {},
      totalCases: 0,
      successfulCases: 0,
      failedCases: 0,
    });
  });

  it("means each metric over only the cases that carry it", () => {
    const aggregate = Result.aggregate(
      suite([
        caseResult([scored("ndcg@5", 1), scored("recall@5", 0.5)]),
        caseResult([scored("ndcg@5", 0), errored("recall@5")]),
      ]),
    );
    expect(aggregate.metrics).toEqual({
      "ndcg@5": { mean: 0.5, cases: 2 },
      "recall@5": { mean: 0.5, cases: 1 },
    });
    expect(aggregate.successfulCases).toBe(2);
  });
});
