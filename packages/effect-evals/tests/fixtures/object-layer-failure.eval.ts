/**
 * A fixture whose `layer` construction fails with a plain object, which the report renders as JSON. It is neither an
 * `Error` nor a string nor a `ConfigError`, so the file is recorded as
 * failed with that rendering.
 *
 * @module tests/fixtures/object-layer-failure.eval
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Dataset, EvalFile, Runner } from "../../src/index.ts";
import { exactMatchMetric } from "./_shared.ts";

const suite = Runner.makeSuite({
  name: "object-layer-failure",
  dataset: Dataset.fromArray("greetings", ["Bonjour"]),
  task: Runner.makeTask<string, string>({ id: "echo@fixture", run: Effect.succeed }),
  metrics: [exactMatchMetric((evalCase) => evalCase.golden === evalCase.output)],
});

export default {
  suites: [suite],
  layer: Layer.effectDiscard(Effect.fail({ code: 42 })),
} satisfies EvalFile.EvalFile<never, { readonly code: number }>;
