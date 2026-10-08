/**
 * The `run` command: translates parsed flags into a {@link Run.RunConfig},
 * runs {@link Run.runEvals}, and renders the result — skip/fail lines always
 * printed, the terminal table and/or JSON file gated by `--reporter` (both
 * by default). Sets `process.exitCode` (rather than failing the command
 * effect) when any executed suite misses its threshold, so a normal run
 * that fails still prints its full report instead of NodeRuntime's defect
 * trace.
 *
 * @module cli/RunCommand
 *
 * @copyright Thomas Foster
 */

import * as Arr from "effect/Array";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/cli";
import * as Reporter from "../Reporter.ts";
import * as Flags from "./Flags.ts";
import * as Report from "./Report.ts";
import * as Run from "./Run.ts";

const DEFAULT_REPORTERS = ["terminal", "json"] as const;

export const runCommand = Command.make(
  "run",
  {
    globs: Flags.globs,
    trials: Flags.trials,
    concurrency: Flags.concurrency,
    force: Flags.force,
    reporter: Flags.reporter,
    filter: Flags.filter,
    out: Flags.out,
  },
  (config) =>
    Effect.gen(function* () {
      // `config` has extra fields (`reporter`, `out`) beyond `Run.RunConfig` —
      // fine to pass as-is since it's a variable, not an object literal
      // (TypeScript only excess-property-checks literals), and keeps this
      // handler from having to restate RunConfig's field list by hand.
      const report = yield* Run.runEvals(config);

      const reporters = Arr.isReadonlyArrayNonEmpty(config.reporter)
        ? config.reporter
        : DEFAULT_REPORTERS;

      yield* Effect.forEach(
        report.skipped,
        (skip) => Console.log(`SKIP  ${skip.file} — ${skip.suites.join(", ")} (${skip.reason})`),
        { concurrency: 1, discard: true },
      );
      yield* Effect.forEach(
        report.failed,
        (failure) => Console.log(`FAIL  ${failure.file} — ${failure.error}`),
        { concurrency: 1, discard: true },
      );

      if (reporters.includes("terminal")) {
        yield* Effect.forEach(
          report.ran.flatMap((fileResult) => fileResult.suites),
          (suiteResult) => Console.log(Reporter.formatTerminalTable(suiteResult)),
          { concurrency: 1, discard: true },
        );
      }

      if (reporters.includes("json")) {
        yield* Report.writeJsonReport(config.out, report);
      }

      if (!report.passed) {
        yield* Effect.sync(() => {
          process.exitCode = 1;
        });
      }
    }),
).pipe(Command.withDescription("Discover and run *.eval.ts suites"));
