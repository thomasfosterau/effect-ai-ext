/**
 * @copyright Thomas Foster
 *
 * The `effect-evals` bin's real entry point — loaded by `bin/effect-evals.js`
 * after it has already re-invoked Node
 * and this package's own `./loader.mjs` resolution hook on the process argv
 * (see that file, and docs/decisions/run-the-toolchain-under-node.md). Wires
 * the Node platform services and the filesystem-backed result cache, then
 * hands off to `Command.run`.
 *
 * Excluded from coverage (`vite.config.ts`) — this is a thin, side-effecting
 * wire-up with nothing worth unit-testing; `Cli.ts`, `RunCommand.ts`, and
 * `Run.ts` carry the actual logic, exercised directly in `tests/cli/`.
 *
 * @module cli/main
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Cache from "../Cache.ts";
import { cli, version } from "./Cli.ts";

const mainLayer = Cache.layerFileSystem(Cache.defaultDirectory).pipe(
  Layer.provideMerge(NodeServices.layer),
);

Command.run(cli, { version }).pipe(Effect.provide(mainLayer), NodeRuntime.runMain);
