/**
 * @copyright Thomas Foster
 *
 * The `run` command's flag and argument definitions, split out from
 * `RunCommand.ts` so unit tests can parse them against a probe handler
 * without exercising real file discovery/loading/execution.
 *
 * @module cli/Flags
 */

import { Argument, Flag } from "effect/cli";
import { DEFAULT_OUT_PATH } from "./Report.ts";
import { DEFAULT_GLOB } from "./Run.ts";

/** Glob patterns to match `*.eval.ts` files; defaults to {@link DEFAULT_GLOB} when none are given. */
export const globs = Argument.String("globs").pipe(
  Argument.variadic(),
  Argument.withDescription(`Glob patterns for *.eval.ts files (default: "${DEFAULT_GLOB}")`),
);

/** How many times each case runs; overrides an eval file's own `options.trials`, and the runner's own default. */
export const trials = Flag.Int("trials").pipe(
  Flag.optional,
  Flag.withDescription("How many times each case runs"),
);

/** Bounded concurrency across cases and metrics; overrides both `caseConcurrency` and `metricConcurrency`. */
export const concurrency = Flag.Int("concurrency").pipe(
  Flag.optional,
  Flag.withDescription("Bounded concurrency across cases and metrics"),
);

/** Bypasses the result cache for this run. */
export const force = Flag.Boolean("force").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Bypass the result cache"),
);

/** Which reporter(s) to produce; repeatable. Defaults to both terminal and JSON when omitted. */
export const reporter = Flag.Literals("reporter", ["json", "terminal"] as const).pipe(
  Flag.atLeast(0),
  Flag.withDescription("Reporter(s) to run — repeatable (default: both terminal and json)"),
);

/** Only run suites whose name contains this substring. */
export const filter = Flag.String("filter").pipe(
  Flag.optional,
  Flag.withDescription("Only run suites whose name contains this substring"),
);

/** Where the JSON reporter writes its combined report. */
export const out = Flag.String("out").pipe(
  Flag.withDefault(DEFAULT_OUT_PATH),
  Flag.withDescription("Where to write the JSON report"),
);
