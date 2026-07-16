/**
 * @copyright Thomas Foster
 *
 * A fixture whose single suite always misses its threshold — exercises the
 * CLI's exit-code behavior (`process.exitCode = 1` iff an executed suite
 * fails). No credentials, no `LanguageModel` — this one runs unconditionally.
 *
 * @module tests/fixtures/failing.eval
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Dataset, EvalFile, Runner } from "@thomasfosterau/effect-evals";
import { exactMatchMetric } from "./_shared";

const alwaysWrongTask = Runner.makeTask<string, string>({
  id: "always-wrong@fixture",
  run: () => Effect.succeed("wrong"),
});

const failingSuite = Runner.makeSuite({
  name: "failing-suite",
  dataset: Dataset.fromArray("greetings", ["Bonjour"]),
  task: alwaysWrongTask,
  metrics: [exactMatchMetric((evalCase) => evalCase.golden === evalCase.output)],
});

export default {
  suites: [failingSuite],
  layer: Layer.empty,
} satisfies EvalFile.EvalFile;
