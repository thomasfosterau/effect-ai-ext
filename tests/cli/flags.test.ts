/**
 * Unit tests for the `run` command's flag/argument parsing (`cli/Flags.ts`):
 * defaults, `--trials`/`--concurrency` as optional integers, `--force`,
 * repeatable `--reporter`, `--filter`, and `--out`. Parses through a probe
 * command sharing the real `Flags` definitions with a trivial handler that
 * just captures the parsed config — so this never touches file discovery,
 * loading, or suite execution (see `tests/cli/run.test.ts` for that).
 *
 * @module tests/cli/flags
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command } from "effect/unstable/cli";
import { NodeServices } from "@effect/platform-node";
import * as Flags from "../../src/cli/Flags";
import { runTest } from "@test-helpers/effect";

interface Captured {
  readonly globs: ReadonlyArray<string>;
  readonly trials: Option.Option<number>;
  readonly concurrency: Option.Option<number>;
  readonly force: boolean;
  readonly reporter: ReadonlyArray<"json" | "terminal">;
  readonly filter: Option.Option<string>;
  readonly out: string;
}

let captured: Captured | undefined;

const probeCommand = Command.make(
  "probe",
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
    Effect.sync(() => {
      captured = config;
    }),
);

const parse = (args: ReadonlyArray<string>) =>
  runTest(
    Command.runWith(probeCommand, { version: "0.0.0" })(args).pipe(
      Effect.provide(NodeServices.layer),
    ),
  );

describe("cli/Flags — run command parsing", () => {
  it("defaults: no globs, no trials/concurrency/filter override, force off, no reporter selection, default out", async () => {
    await parse([]);

    expect(captured?.globs).toEqual([]);
    expect(Option.isNone(captured!.trials)).toBe(true);
    expect(Option.isNone(captured!.concurrency)).toBe(true);
    expect(captured?.force).toBe(false);
    expect(captured?.reporter).toEqual([]);
    expect(Option.isNone(captured!.filter)).toBe(true);
    expect(captured?.out).toBe(".effect-evals/results.json");
  });

  it("parses variadic positional globs", async () => {
    await parse(["packages/jobs/evals/*.eval.ts", "packages/ai/evals/*.eval.ts"]);

    expect(captured?.globs).toEqual([
      "packages/jobs/evals/*.eval.ts",
      "packages/ai/evals/*.eval.ts",
    ]);
  });

  it("parses --trials and --concurrency as integers", async () => {
    await parse(["--trials", "5", "--concurrency", "2"]);

    expect(Option.getOrThrow(captured!.trials)).toBe(5);
    expect(Option.getOrThrow(captured!.concurrency)).toBe(2);
  });

  it("parses --force", async () => {
    await parse(["--force"]);
    expect(captured?.force).toBe(true);
  });

  it("parses repeated --reporter flags", async () => {
    await parse(["--reporter", "terminal", "--reporter", "json"]);
    expect(captured?.reporter).toEqual(["terminal", "json"]);
  });

  it("parses --filter", async () => {
    await parse(["--filter", "translation"]);
    expect(Option.getOrThrow(captured!.filter)).toBe("translation");
  });

  it("parses --out, overriding the default", async () => {
    await parse(["--out", "./tmp/report.json"]);
    expect(captured?.out).toBe("./tmp/report.json");
  });

  it("parses flags together with globs", async () => {
    await parse(["--trials", "3", "--force", "packages/jobs/evals/*.eval.ts"]);

    expect(Option.getOrThrow(captured!.trials)).toBe(3);
    expect(captured?.force).toBe(true);
    expect(captured?.globs).toEqual(["packages/jobs/evals/*.eval.ts"]);
  });
});
