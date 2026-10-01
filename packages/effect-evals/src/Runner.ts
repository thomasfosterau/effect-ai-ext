/**
 * `runSuite` — the engine every execution surface (the vite-plus/test
 * adapter, website#929, and the CLI, website#930) sits on: for each golden,
 * run the task (the system-under-test) with its own `R` flowing through,
 * build the resulting
 * {@link EvaluatedCase}, run every {@link Metric.Metric} against it, and
 * aggregate. No test-framework coupling — this module returns the typed
 * {@link Result.SuiteResult} model.
 *
 * - **Concurrency** is bounded independently at the case level
 *   (`caseConcurrency`), the trial level, and the metric level (both
 *   `metricConcurrency` — a case's trials and a trial's metrics are equally
 *   independent fan-out, so they share one knob).
 * - **Trials**: each case runs `trials` times end to end (task + every
 *   metric); a metric's result aggregates mean/variance/stddev/min/max
 *   across its trials, with the pass/fail verdict applied to the mean.
 * - **Retries**: the task and each metric evaluation are retried
 *   independently on a retryable `AiError` (`isRetryable`), with backoff;
 *   any other failure (or an `AiError` that isn't retryable) surfaces as a
 *   typed trial error rather than being retried.
 * - **Caching**: keyed on the golden, the task id, the metric name, the
 *   judge model id, and the trial number (see {@link Cache}); a hit skips
 *   both the task call and the metric's judge call for that trial.
 * - **Errors vs failing scores**: a metric whose Effect fails is recorded as
 *   `Errored`, distinct from a `Scored` result that misses its threshold.
 *   `ignoreErrors` (default `false`) controls whether an error excludes that
 *   trial from the metric's aggregate (and doesn't affect pass/fail) or
 *   forces the metric — and the case — to fail.
 *
 * @module Runner
 *
 * @copyright Thomas Foster
 */

import * as Arr from "effect/Array";
import { ConfigError } from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as EffectResult from "effect/Result";
import * as Schedule from "effect/Schedule";
import { AiError } from "effect/ai";
import * as Cache from "./Cache.ts";
import * as Dataset from "./Dataset.ts";
import * as Metric from "./Metric.ts";
import * as Ranking from "./metrics/Ranking.ts";
import * as Reporter from "./Reporter.ts";
import * as Result from "./Result.ts";
import type { Score } from "./Score.ts";
import * as Threshold from "./Threshold.ts";

/**
 * Whether a `layer` build failure is a `Config.ConfigError` — the
 * credential-gating signal every execution surface (the
 * adapter and the CLI) key off to skip rather than fail when a required
 * provider credential is unset. Each builds and classifies `layer` with its
 * own combinator (`Effect.exit`+`Cause` for per-suite isolation, `Effect.result`
 * for per-file batching — see `./cli/Run.ts`), so
 * this predicate is the one piece of that classification actually shared.
 */
export const isConfigError = (error: unknown): error is ConfigError => error instanceof ConfigError;

/** A named, effectful task (the system-under-test) with a stable id for cache keys. */
export interface TaskDefinition<Golden, Output, E = never, R = never> {
  readonly id: string;
  readonly run: (golden: Golden) => Effect.Effect<Output, E, R>;
}

/** Constructs a {@link TaskDefinition} from its id and run function. */
export const makeTask = <Golden, Output, E = never, R = never>(
  options: TaskDefinition<Golden, Output, E, R>,
): TaskDefinition<Golden, Output, E, R> => options;

/** A golden enriched with the task's output and run duration. */
export interface EvaluatedCase<Golden, Output> {
  readonly golden: Golden;
  readonly output: Output;
  readonly durationMillis: number;
}

/** A suite: a dataset of goldens, the task under test, and the metrics run against each case. */
export interface Suite<
  Golden,
  Output,
  GoldenE = never,
  GoldenR = never,
  TaskE = never,
  TaskR = never,
  MetricE = never,
  MetricR = never,
> {
  readonly name: string;
  readonly dataset: Dataset.Dataset<Golden, GoldenE, GoldenR>;
  readonly task: TaskDefinition<Golden, Output, TaskE, TaskR>;
  readonly metrics: ReadonlyArray<Metric.Metric<EvaluatedCase<Golden, Output>, MetricE, MetricR>>;
}

/** Any {@link Metric.Metric} over a given case, `E`/`R` left open — the constraint `makeSuite`'s heterogeneous `metrics` tuple parameter is bounded by. */
type AnyMetric<Case> = Metric.Metric<Case, any, any>;

/**
 * Unions a heterogeneous `metrics` tuple's per-element `E` into `MetricE`
 * instead of `makeSuite` fixing it from the first element — the same
 * `T[number] extends ... ? ... : never` pattern `effect`'s own
 * `Effect.All.ReturnTuple` uses for the equivalent problem (an array of
 * `Effect`s with different `E`/`R`). Requires `Metrics` to be inferred as a
 * literal tuple rather than widened to `AnyMetric<Case>[]` — see `makeSuite`'s
 * `const Metrics` type parameter.
 */
type MetricErrorOf<Metrics extends ReadonlyArray<AnyMetric<any>>> = Metrics[number] extends never
  ? never
  : Metrics[number] extends Metric.Metric<any, infer E, any>
    ? E
    : never;

/** The `R` counterpart of {@link MetricErrorOf}. */
type MetricRequirementOf<Metrics extends ReadonlyArray<AnyMetric<any>>> =
  Metrics[number] extends never
    ? never
    : Metrics[number] extends Metric.Metric<any, any, infer R>
      ? R
      : never;

/**
 * Constructs a {@link Suite} from its name, dataset, task, and metrics. The
 * `metrics` array may freely mix metrics with different `E`/`R` — a G-Eval
 * judge (`GEvalError`/`LanguageModel`) alongside an `embeddingSimilarity`
 * metric (`AiError`/`EmbeddingModel`), say — without an explicit array type
 * annotation at the call site: `Metrics` is inferred as a literal tuple (the
 * `const` type parameter modifier) so `MetricE`/`MetricR` are unioned across
 * its elements instead of fixed from the first one.
 */
export const makeSuite = <
  Golden,
  Output,
  GoldenE = never,
  GoldenR = never,
  TaskE = never,
  TaskR = never,
  const Metrics extends ReadonlyArray<AnyMetric<EvaluatedCase<Golden, Output>>> = ReadonlyArray<
    Metric.Metric<EvaluatedCase<Golden, Output>, never, never>
  >,
>(options: {
  readonly name: string;
  readonly dataset: Dataset.Dataset<Golden, GoldenE, GoldenR>;
  readonly task: TaskDefinition<Golden, Output, TaskE, TaskR>;
  readonly metrics: Metrics;
}): Suite<
  Golden,
  Output,
  GoldenE,
  GoldenR,
  TaskE,
  TaskR,
  MetricErrorOf<Metrics>,
  MetricRequirementOf<Metrics>
> => options;

/** Runner configuration; every field has a sensible default. */
export interface RunnerOptions<ReporterR = never> {
  /** How many times each case (task + every metric) runs end to end. Default `1`; clamped to at least `1`. */
  readonly trials?: number;
  /** Bounded concurrency across cases. Default `5`. */
  readonly caseConcurrency?: number | "unbounded";
  /** Bounded concurrency across a case's trials, and across a trial's metrics. Default `5`. */
  readonly metricConcurrency?: number | "unbounded";
  /** Whether a trial error excludes it from aggregation instead of failing the metric/case. Default `false`. */
  readonly ignoreErrors?: boolean;
  /** Skip cache reads and writes entirely. Default `false`. */
  readonly bypassCache?: boolean;
  /** The judge model id folded into metric cache keys. */
  readonly judgeModelId?: string;
  /** Retry policy for the task, applied only to retryable `AiError`s. Defaults to a jittered, capped exponential backoff. */
  readonly taskRetrySchedule?: Schedule.Schedule<unknown, unknown>;
  /** Retry policy for metric evaluation, applied only to retryable `AiError`s. Defaults to a jittered, capped exponential backoff. */
  readonly metricRetrySchedule?: Schedule.Schedule<unknown, unknown>;
  /** Reporters invoked once, after the suite completes. */
  readonly reporters?: ReadonlyArray<Reporter.Reporter<ReporterR>>;
}

const DEFAULT_TRIALS = 1;
const DEFAULT_CASE_CONCURRENCY = 5;
const DEFAULT_METRIC_CONCURRENCY = 5;

const defaultRetrySchedule = Schedule.max([
  Schedule.exponential(Duration.millis(200)),
  Schedule.recurs(3),
]).pipe(Schedule.jittered);

type ResolvedConfig = Required<Omit<RunnerOptions<never>, "reporters" | "judgeModelId">> & {
  readonly judgeModelId: string | undefined;
};

/** Retries only on a retryable `AiError`; any other failure (or a non-retryable `AiError`) surfaces immediately. */
const retryAiErrors = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  schedule: Schedule.Schedule<unknown, unknown>,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.retry({ schedule, while: (error) => AiError.isAiError(error) && error.isRetryable }),
  );

/** Resolves a cache key unless caching is bypassed for this run. */
const cacheKeyFor = (
  config: ResolvedConfig,
  input: Cache.CacheKeyInput,
): Effect.Effect<string | undefined> =>
  config.bypassCache ? Effect.succeed(undefined) : Cache.hashKey(input);

const cacheGetJson = <A>(
  key: string,
): Effect.Effect<A | undefined, never, Cache.KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const kv = yield* Cache.KeyValueStore.KeyValueStore;
    const raw: string | undefined = yield* kv
      .get(key)
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("effect-evals cache read failed", error).pipe(Effect.as(undefined)),
        ),
      );
    if (raw === undefined) return undefined;
    return yield* Effect.try(() => JSON.parse(raw) as A).pipe(
      Effect.catch(() => Effect.succeed<A | undefined>(undefined)),
    );
  });

const cacheSetJson = <A>(
  key: string,
  value: A,
): Effect.Effect<void, never, Cache.KeyValueStore.KeyValueStore> =>
  Cache.KeyValueStore.KeyValueStore.pipe(
    Effect.flatMap((kv) => kv.set(key, JSON.stringify(value))),
    Effect.catch((error) => Effect.logWarning("effect-evals cache write failed", error)),
  );

type TaskRunOutcome<Output> =
  | { readonly _tag: "Succeeded"; readonly output: Output; readonly durationMillis: number }
  | { readonly _tag: "Failed"; readonly error: unknown };

const runTaskTrial = <Golden, Output, TaskE, TaskR>(
  task: TaskDefinition<Golden, Output, TaskE, TaskR>,
  golden: Golden,
  trial: number,
  config: ResolvedConfig,
): Effect.Effect<TaskRunOutcome<Output>, never, TaskR | Cache.KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const cacheKey = yield* cacheKeyFor(config, { golden, taskId: task.id, trial });

    if (cacheKey !== undefined) {
      const cached = yield* cacheGetJson<Output>(cacheKey);
      if (cached !== undefined) {
        return { _tag: "Succeeded" as const, output: cached, durationMillis: 0 };
      }
    }

    const timedResult = yield* Effect.result(
      Effect.timed(retryAiErrors(task.run(golden), config.taskRetrySchedule)),
    );

    if (EffectResult.isFailure(timedResult)) {
      return { _tag: "Failed" as const, error: timedResult.failure };
    }

    const [duration, output] = timedResult.success;
    if (cacheKey !== undefined) {
      yield* cacheSetJson(cacheKey, output);
    }

    return { _tag: "Succeeded" as const, output, durationMillis: Duration.toMillis(duration) };
  });

interface MetricTrialResult {
  readonly metric: string;
  readonly outcome: Result.MetricTrialOutcome;
}

const runMetricTrial = <Golden, Output, MetricE, MetricR>(
  metric: Metric.Metric<EvaluatedCase<Golden, Output>, MetricE, MetricR>,
  evalCase: EvaluatedCase<Golden, Output>,
  taskId: string,
  trial: number,
  config: ResolvedConfig,
): Effect.Effect<MetricTrialResult, never, MetricR | Cache.KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const cacheKey = yield* cacheKeyFor(config, {
      golden: evalCase.golden,
      taskId,
      metric: metric.name,
      judgeModelId: config.judgeModelId,
      trial,
    });

    if (cacheKey !== undefined) {
      const cached = yield* cacheGetJson<Score>(cacheKey);
      if (cached !== undefined) {
        return {
          metric: metric.name,
          outcome: { _tag: "Scored" as const, trial, score: cached, cached: true },
        };
      }
    }

    const evaluated = yield* Effect.result(
      retryAiErrors(Metric.evaluate(metric, evalCase), config.metricRetrySchedule),
    );

    if (EffectResult.isFailure(evaluated)) {
      return {
        metric: metric.name,
        outcome: { _tag: "Errored" as const, trial, error: evaluated.failure, cached: false },
      };
    }

    if (cacheKey !== undefined) {
      yield* cacheSetJson(cacheKey, evaluated.success.score);
    }

    return {
      metric: metric.name,
      outcome: { _tag: "Scored" as const, trial, score: evaluated.success.score, cached: false },
    };
  });

type TrialRun =
  | {
      readonly _tag: "TaskSucceeded";
      readonly trial: number;
      readonly metricOutcomes: ReadonlyArray<MetricTrialResult>;
    }
  | { readonly _tag: "TaskFailed"; readonly trial: number; readonly error: unknown };

const runTrial = <Golden, Output, TaskE, TaskR, MetricE, MetricR>(
  task: TaskDefinition<Golden, Output, TaskE, TaskR>,
  metrics: ReadonlyArray<Metric.Metric<EvaluatedCase<Golden, Output>, MetricE, MetricR>>,
  golden: Golden,
  trial: number,
  config: ResolvedConfig,
): Effect.Effect<TrialRun, never, TaskR | MetricR | Cache.KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const taskOutcome = yield* runTaskTrial(task, golden, trial, config);

    if (taskOutcome._tag === "Failed") {
      return { _tag: "TaskFailed" as const, trial, error: taskOutcome.error };
    }

    const evalCase: EvaluatedCase<Golden, Output> = {
      golden,
      output: taskOutcome.output,
      durationMillis: taskOutcome.durationMillis,
    };

    const metricOutcomes = yield* Effect.forEach(
      metrics,
      (metric) => runMetricTrial(metric, evalCase, task.id, trial, config),
      { concurrency: config.metricConcurrency },
    );

    return { _tag: "TaskSucceeded" as const, trial, metricOutcomes };
  });

const runCase = <Golden, Output, TaskE, TaskR, MetricE, MetricR>(
  task: TaskDefinition<Golden, Output, TaskE, TaskR>,
  metrics: ReadonlyArray<Metric.Metric<EvaluatedCase<Golden, Output>, MetricE, MetricR>>,
  golden: Golden,
  config: ResolvedConfig,
): Effect.Effect<
  Result.CaseResult<Golden>,
  never,
  TaskR | MetricR | Cache.KeyValueStore.KeyValueStore
> =>
  Effect.gen(function* () {
    const trialRuns = yield* Effect.forEach(
      Arr.range(1, config.trials),
      (trial) => runTrial(task, metrics, golden, trial, config),
      { concurrency: config.metricConcurrency },
    );

    const taskFailures: Array<Result.TaskTrialFailure> = [];
    const successes: Array<Extract<TrialRun, { readonly _tag: "TaskSucceeded" }>> = [];
    for (const run of trialRuns) {
      if (run._tag === "TaskFailed") taskFailures.push({ trial: run.trial, error: run.error });
      else successes.push(run);
    }

    // One name → outcome map per successful trial, so aggregating below is
    // O(trials × metrics) instead of an O(trials × metrics²) linear scan.
    const outcomesByMetric = successes.map(
      (run) => new Map(run.metricOutcomes.map((entry) => [entry.metric, entry.outcome] as const)),
    );

    const metricAggregates = metrics.map((metric): Result.MetricAggregate => {
      const outcomes = outcomesByMetric
        .map((byMetric) => byMetric.get(metric.name))
        .filter((outcome): outcome is Result.MetricTrialOutcome => outcome !== undefined);
      const scores = outcomes
        .filter((outcome) => outcome._tag === "Scored")
        .map((outcome) => outcome.score.score);
      const errorCount = outcomes.length - scores.length;
      const summary = scores.length > 0 ? Result.summarize(scores) : undefined;
      const passed =
        summary !== undefined &&
        Threshold.passes(metric.threshold, summary.mean) &&
        (config.ignoreErrors || errorCount === 0);
      return { metric: metric.name, trials: outcomes, summary, errorCount, passed };
    });

    const passed =
      successes.length > 0 &&
      (config.ignoreErrors || taskFailures.length === 0) &&
      metricAggregates.every((aggregate) => aggregate.passed);

    return { golden, trials: config.trials, taskFailures, metrics: metricAggregates, passed };
  });

/**
 * Runs a suite end to end: loads its goldens, runs the task and every metric
 * for each (bounded concurrency, `trials` repetitions, retry on retryable
 * `AiError`s, content-hash caching), aggregates the result, and invokes
 * every reporter. Returns the typed {@link Result.SuiteResult} — never
 * throws for a task or metric failure, only for the dataset itself failing
 * to load.
 */
export const runSuite = <
  Golden,
  Output,
  GoldenE,
  GoldenR,
  TaskE,
  TaskR,
  MetricE,
  MetricR,
  ReporterR = never,
>(
  suite: Suite<Golden, Output, GoldenE, GoldenR, TaskE, TaskR, MetricE, MetricR>,
  options: RunnerOptions<ReporterR> = {},
): Effect.Effect<
  Result.SuiteResult<Golden>,
  GoldenE,
  GoldenR | TaskR | MetricR | ReporterR | Cache.KeyValueStore.KeyValueStore
> =>
  Effect.gen(function* () {
    const config: ResolvedConfig = {
      trials: Math.max(1, Math.trunc(options.trials ?? DEFAULT_TRIALS)),
      caseConcurrency: options.caseConcurrency ?? DEFAULT_CASE_CONCURRENCY,
      metricConcurrency: options.metricConcurrency ?? DEFAULT_METRIC_CONCURRENCY,
      ignoreErrors: options.ignoreErrors ?? false,
      bypassCache: options.bypassCache ?? false,
      judgeModelId: options.judgeModelId,
      taskRetrySchedule: options.taskRetrySchedule ?? defaultRetrySchedule,
      metricRetrySchedule: options.metricRetrySchedule ?? defaultRetrySchedule,
    };

    const goldens = yield* suite.dataset.goldens;

    const [duration, cases] = yield* Effect.timed(
      Effect.forEach(goldens, (golden) => runCase(suite.task, suite.metrics, golden, config), {
        concurrency: config.caseConcurrency,
      }),
    );

    const result: Result.SuiteResult<Golden> = {
      suite: suite.name,
      cases,
      passed: cases.every((caseResult) => caseResult.passed),
      durationMillis: Duration.toMillis(duration),
    };

    yield* Effect.forEach(options.reporters ?? [], (reporter) => reporter.report(result), {
      concurrency: "unbounded",
      discard: true,
    });

    return result;
  });

// ── Retrieval suites ─────────────────────────────────────────────────

/**
 * The golden of a retrieval case: one query and its graded ground truth.
 * Handles are whatever the {@link RetrievalPort} returns — a checked-in
 * dataset has to name documents in a way a reviewer can read and a rebuilt
 * environment still resolves (`type:slug`, say), never an opaque row id.
 */
export interface RetrievalGolden {
  /** The query as a user would type it. */
  readonly query: string;
  /** Handle → grade; see {@link Ranking.GradedRelevance}. */
  readonly relevant: Ranking.GradedRelevance;
  /** A stable name for the case within its dataset, for reports. */
  readonly name?: string | undefined;
}

/**
 * The seam a retrieval suite measures through: one method, no knowledge of
 * what is behind it. The thing being measured — a search operation, a
 * reranker chain — lives in the consumer; the suite hands it each golden's
 * query and the page size, and reads back handles, best first.
 *
 * That seam is also what makes an offline mode the same code path as the
 * credentialed one: a unit suite hands the runner an in-memory port over
 * fixed orderings, an operator hands it one closing over a live search and
 * reranker, and the runner cannot tell.
 *
 * `id` names the configuration under test (`"search@rerank-v3.5"`) and is
 * the task id in the result cache key — bump it when the port's behaviour
 * changes, as with any {@link TaskDefinition}.
 */
export interface RetrievalPort<E = never, R = never> {
  readonly id: string;
  /** Handles for one query, best first, at most `limit` of them. */
  readonly retrieve: (
    query: string,
    options: { readonly limit: number },
  ) => Effect.Effect<ReadonlyArray<string>, E, R>;
}

/** A retrieval suite: a dataset of {@link RetrievalGolden}s, the port under test, and the cutoff. */
export interface RetrievalSuite<GoldenE = never, GoldenR = never, PortE = never, PortR = never> {
  readonly name: string;
  readonly dataset: Dataset.Dataset<RetrievalGolden, GoldenE, GoldenR>;
  readonly port: RetrievalPort<PortE, PortR>;
  /** Page size, and the `k` every cutoff metric uses. */
  readonly k: number;
  /** Which ranking metrics to score, and any pass/fail thresholds. Default: all four, never failing. */
  readonly metrics?: Ranking.MetricsAtKOptions | undefined;
}

/** A {@link Result.SuiteResult} over retrieval goldens plus its cross-query aggregate. */
export interface RetrievalSuiteResult extends Result.SuiteResult<RetrievalGolden> {
  /** Per-metric means across the queries that scored; see {@link Result.aggregate}. */
  readonly aggregate: Result.Aggregate;
}

/**
 * Runs a retrieval-ranking suite: every golden's query goes through the
 * port (truncated to `k` — a port that over-returns must not inflate
 * recall), and the ranked handles are scored against the golden's graded
 * relevance by the requested {@link Ranking} metrics at `k`. Built on
 * {@link runSuite}, so trials, retry on retryable `AiError`s, caching (keyed
 * on the port's `id`) and reporters all apply; the result is the ordinary
 * per-case {@link Result.SuiteResult} plus a cross-query
 * {@link Result.aggregate}.
 *
 * A query whose retrieval fails is recorded as that case's `taskFailures`,
 * is excluded from every mean, and is counted in `aggregate.failedCases` —
 * never scored as a zero. A suite in which every query failed has an empty
 * `aggregate.metrics` and `passed: false`.
 *
 * Cases run **sequentially by default** (`caseConcurrency: 1`): a
 * retrieval suite is usually run against a live search plane, and
 * measuring it under a load pattern no user produces makes any latency the
 * port records meaningless. Pass `caseConcurrency` to change that.
 */
export const runRetrievalSuite = <GoldenE, GoldenR, PortE, PortR, ReporterR = never>(
  suite: RetrievalSuite<GoldenE, GoldenR, PortE, PortR>,
  options: RunnerOptions<ReporterR> = {},
): Effect.Effect<
  RetrievalSuiteResult,
  GoldenE,
  GoldenR | PortR | ReporterR | Cache.KeyValueStore.KeyValueStore
> =>
  runSuite(
    makeSuite({
      name: suite.name,
      dataset: suite.dataset,
      task: makeTask<RetrievalGolden, ReadonlyArray<string>, PortE, PortR>({
        id: `${suite.port.id}@k=${suite.k}`,
        run: (golden) =>
          suite.port
            .retrieve(golden.query, { limit: suite.k })
            .pipe(Effect.map((ranked) => ranked.slice(0, suite.k))),
      }),
      metrics: Ranking.metricsAtK(suite.k, suite.metrics ?? {}),
    }),
    { caseConcurrency: 1, ...options },
  ).pipe(Effect.map((result) => ({ ...result, aggregate: Result.aggregate(result) })));
