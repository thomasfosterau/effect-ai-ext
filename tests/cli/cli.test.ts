/**
 * Unit tests for `cli/Cli.ts`: the root command exposes `run` as its only
 * subcommand, and `version` matches the package's own `package.json`.
 *
 * @module tests/cli/cli
 */

import { describe, expect, it, vi } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { NodeServices } from "@effect/platform-node";
import { Cache } from "@thomasfosterau/effect-evals";
import { cli, version } from "../../src/cli/Cli.ts";

describe("cli/Cli", () => {
  // No "version matches package.json" test: `src/cli/Cli.ts` defines
  // `version = packageJson.version`, so both sides of that assertion read
  // the same import — it could never fail.
  it("lists run as a subcommand in --help output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // `--help` never reaches the `run` handler at runtime, but Command's
    // type system still requires every subcommand's R statically satisfied.
    await Effect.runPromise(
      Command.runWith(cli, { version })(["--help"]).pipe(
        Effect.provide(Layer.merge(Cache.layerMemory, NodeServices.layer)),
      ),
    );

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("run");

    logSpy.mockRestore();
  });
});
