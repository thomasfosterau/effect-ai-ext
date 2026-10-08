/**
 * A fixture whose `layer` construction fails with a `BigInt`, which `JSON.stringify` cannot serialise, so the report falls back to `String(value)`. It is neither an
 * `Error` nor a string nor a `ConfigError`, so the file is recorded as
 * failed with that rendering.
 *
 * @module tests/fixtures/bigint-layer-failure.eval
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Dataset, EvalFile, Runner } from "../../src/index.ts";
import { exactMatchMetric } from "./_shared.ts";

const suite = Runner.makeSuite({
  name: "bigint-layer-failure",
  dataset: Dataset.fromArray("greetings", ["Bonjour"]),
  task: Runner.makeTask<string, string>({ id: "echo@fixture", run: Effect.succeed }),
  metrics: [exactMatchMetric((evalCase) => evalCase.golden === evalCase.output)],
});

export default {
  suites: [suite],
  layer: Layer.effectDiscard(Effect.fail(1n)),
} satisfies EvalFile.EvalFile<never, bigint>;
