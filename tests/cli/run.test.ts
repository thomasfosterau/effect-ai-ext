/**
 * Unit tests for `cli/Run.runEvals`: the framework-agnostic orchestration
 * behind the `run` command, against the real fixture files in
 * `tests/fixtures/`. Covers the pass/fail/skip/failed-to-load outcomes, the
 * `--filter` substring match, `--trials` propagation, and `--force`
 * bypassing the cache — end to end, with an in-memory cache and a stubbed
 * `LanguageModel` (no network reached).
 *
 * @module tests/cli/run
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Cache } from "@thomasfosterau/effect-evals";
import { runEvals } from "../../src/cli/Run";
import { runTest } from "@test-helpers/effect";

const FIXTURES = new URL("../fixtures/", import.meta.url);
const fixture = (name: string): string => new URL(name, FIXTURES).pathname;

const baseConfig = {
  trials: Option.none<number>(),
  concurrency: Option.none<number>(),
  force: false,
  filter: Option.none<string>(),
};

describe("cli/Run.runEvals", () => {
  it("runs a passing suite through a stubbed LanguageModel layer", async () => {
    const report = await runTest(
      runEvals({ ...baseConfig, globs: [fixture("sample.eval.ts")] }).pipe(
        Effect.provide(Cache.layerMemory),
      ),
    );

    expect(report.passed).toBe(true);
    expect(report.skipped).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.ran).toHaveLength(1);
    expect(report.ran[0]?.suites[0]?.suite).toBe("fixture-greetings");
    expect(report.ran[0]?.suites[0]?.passed).toBe(true);
  });

  it("marks the run failed when an executed suite misses its threshold", async () => {
    const report = await runTest(
      runEvals({ ...baseConfig, globs: [fixture("failing.eval.ts")] }).pipe(
        Effect.provide(Cache.layerMemory),
      ),
    );

    expect(report.passed).toBe(false);
    expect(report.ran).toHaveLength(1);
    expect(report.ran[0]?.suites[0]?.passed).toBe(false);
    expect(report.failed).toEqual([]);
    expect(report.skipped).toEqual([]);
  });

  it("skips a file whose layer fails with a ConfigError, naming the missing config, and does not fail the run", async () => {
    const report = await runTest(
      runEvals({ ...baseConfig, globs: [fixture("config-gated.eval.ts")] }).pipe(
        Effect.provide(Cache.layerMemory),
      ),
    );

    expect(report.ran).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]?.suites).toEqual(["config-gated-suite"]);
    expect(report.skipped[0]?.reason).toContain("EFFECT_EVALS_FIXTURE_NEVER_SET_TOKEN");
    expect(report.passed).toBe(true);
  });

  it("records a file that fails to load/validate as failed, and fails the run", async () => {
    const report = await runTest(
      runEvals({ ...baseConfig, globs: [fixture("invalid.eval.ts")] }).pipe(
        Effect.provide(Cache.layerMemory),
      ),
    );

    expect(report.ran).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.passed).toBe(false);
  });

  it("--filter excludes files whose every suite name misses the substring", async () => {
    const report = await runTest(
      runEvals({
        ...baseConfig,
        globs: [fixture("sample.eval.ts")],
        filter: Option.some("does-not-match-anything"),
      }).pipe(Effect.provide(Cache.layerMemory)),
    );

    expect(report.ran).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("--filter runs only suites whose name contains the substring", async () => {
    const report = await runTest(
      runEvals({
        ...baseConfig,
        globs: [fixture("sample.eval.ts")],
        filter: Option.some("fixture-greet"),
      }).pipe(Effect.provide(Cache.layerMemory)),
    );

    expect(report.ran).toHaveLength(1);
    expect(report.ran[0]?.suites[0]?.suite).toBe("fixture-greetings");
  });

  it("--trials overrides the eval file's own default", async () => {
    const report = await runTest(
      runEvals({
        ...baseConfig,
        globs: [fixture("sample.eval.ts")],
        trials: Option.some(3),
      }).pipe(Effect.provide(Cache.layerMemory)),
    );

    expect(report.ran[0]?.suites[0]?.cases[0]?.trials).toBe(3);
  });

  it("force: true bypasses the cache even after a prior run populated it", async () => {
    const config = { ...baseConfig, globs: [fixture("sample.eval.ts")] };

    const [first, second, third] = await runTest(
      Effect.gen(function* () {
        const r1 = yield* runEvals(config);
        const r2 = yield* runEvals(config);
        const r3 = yield* runEvals({ ...config, force: true });
        return [r1, r2, r3] as const;
      }).pipe(Effect.provide(Cache.layerMemory)),
    );

    const trialOf = (report: typeof first) =>
      report.ran[0]?.suites[0]?.cases[0]?.metrics[0]?.trials[0];

    expect(trialOf(first)).toMatchObject({ cached: false });
    expect(trialOf(second)).toMatchObject({ cached: true });
    expect(trialOf(third)).toMatchObject({ cached: false });
  });

  it("returns a failed-run report instead of throwing when glob discovery itself errors", async () => {
    // node:fs/promises' glob throws synchronously on a non-string cwd;
    // bypass the type system to exercise runEvals' own error mapping.
    const malformedCwd = 123 as unknown as string;

    const report = await runTest(
      runEvals({
        ...baseConfig,
        globs: [fixture("sample.eval.ts")],
        cwd: malformedCwd,
      }).pipe(Effect.provide(Cache.layerMemory)),
    );

    expect(report.passed).toBe(false);
    expect(report.failed).toHaveLength(1);
  });
});
