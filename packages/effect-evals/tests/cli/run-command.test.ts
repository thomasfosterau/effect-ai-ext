/**
 * End-to-end tests for the `run` command (`cli/RunCommand.ts`) as a whole:
 * flags parsed through `Command.runWith`, real fixture files loaded and run
 * through a stubbed `LanguageModel` and an in-memory cache (no network,
 * no real disk — the JSON reporter's `FileSystem` is `FileSystem.makeNoop`,
 * captured in-memory), terminal + skip/fail line output, and
 * `process.exitCode` set iff the run failed.
 *
 * @module tests/cli/run-command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";
import { NodeServices } from "@effect/platform-node";
import { Cache } from "../../src/index.ts";
import { runCommand } from "../../src/cli/RunCommand.ts";

const FIXTURES = new URL("../fixtures/", import.meta.url);
const fixture = (name: string): string => new URL(name, FIXTURES).pathname;

let originalExitCode: typeof process.exitCode;

beforeEach(() => {
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
});

/** Runs `run` with `args`, providing an in-memory cache and a captured, disk-free `FileSystem` for JSON output. */
const runCli = (
  args: ReadonlyArray<string>,
  writes: Array<{ path: string; content: string }> = [],
) => {
  const testFs = FileSystem.makeNoop({
    writeFileString: (path, content) =>
      Effect.sync(() => {
        writes.push({ path: String(path), content });
      }),
    makeDirectory: () => Effect.void,
  });

  return Effect.runPromise(
    Command.runWith(runCommand, { version: "0.0.0" })(args).pipe(
      // Order matters: `provideService` must apply before `provide(NodeServices.layer)`
      // — Effect resolves a requirement against the nearest (innermost) provider in the
      // pipe, so this test double for `FileSystem` has to be supplied ahead of the real
      // Node one or the real one wins and the JSON report hits actual disk.
      Effect.provideService(FileSystem.FileSystem, testFs),
      Effect.provide(Layer.merge(NodeServices.layer, Cache.layerMemory)),
    ),
  );
};

describe("cli/RunCommand — run", () => {
  it("prints the terminal report and leaves exitCode unset for a passing run", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["run", fixture("sample.eval.ts"), "--reporter", "terminal"]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("fixture-greetings");
    expect(output).toContain("PASS");
    expect(process.exitCode).toBeUndefined();
  });

  it("sets exitCode to 1 when an executed suite fails its threshold", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["run", fixture("failing.eval.ts"), "--reporter", "terminal"]);

    expect(process.exitCode).toBe(1);
  });

  it("prints a SKIP line for a credential-gated file and leaves exitCode unset", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["run", fixture("config-gated.eval.ts")]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("SKIP");
    expect(output).toContain("config-gated.eval.ts");
    expect(output).toContain("EFFECT_EVALS_FIXTURE_NEVER_SET_TOKEN");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints a FAIL line and sets exitCode for a file that fails to load", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["run", fixture("invalid.eval.ts")]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("FAIL");
    expect(output).toContain("invalid.eval.ts");
    expect(process.exitCode).toBe(1);
  });

  it("--reporter json writes the combined report and skips the terminal table", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const writes: Array<{ path: string; content: string }> = [];

    await runCli(
      ["run", fixture("sample.eval.ts"), "--reporter", "json", "--out", "out.json"],
      writes,
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("out.json");
    const parsed = JSON.parse(writes[0]?.content ?? "{}");
    expect(parsed.passed).toBe(true);
    expect(parsed.ran[0]?.suites[0]?.suite).toBe("fixture-greetings");

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).not.toContain("fixture-greetings");
  });

  it("defaults to both terminal and json when --reporter is omitted", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const writes: Array<{ path: string; content: string }> = [];

    await runCli(["run", fixture("sample.eval.ts")], writes);

    expect(writes).toHaveLength(1);
    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("fixture-greetings");
  });
});
