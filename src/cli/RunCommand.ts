/**
 * @copyright Thomas Foster
 *
 * The `run` command: translates parsed flags into a {@link Run.RunConfig},
 * runs {@link Run.runEvals}, and renders the result — skip/fail lines always
 * printed, the terminal table and/or JSON file gated by `--reporter` (both
 * by default). Sets `process.exitCode` (rather than failing the command
 * effect) when any executed suite misses its threshold, so a normal run
 * that fails still prints its full report instead of NodeRuntime's defect
 * trace.
 *
 * @module cli/RunCommand
 */

import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";
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

      const reporters = config.reporter.length > 0 ? config.reporter : DEFAULT_REPORTERS;

      for (const skip of report.skipped) {
        yield* Console.log(`SKIP  ${skip.file} — ${skip.suites.join(", ")} (${skip.reason})`);
      }
      for (const failure of report.failed) {
        yield* Console.log(`FAIL  ${failure.file} — ${failure.error}`);
      }

      if (reporters.includes("terminal")) {
        for (const fileResult of report.ran) {
          for (const suiteResult of fileResult.suites) {
            yield* Console.log(Reporter.formatTerminalTable(suiteResult));
          }
        }
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
