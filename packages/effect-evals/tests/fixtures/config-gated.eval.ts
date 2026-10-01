/**
 * @copyright Thomas Foster
 *
 * A fixture whose `layer` construction fails with a `Config.ConfigError`
 * (reads a config value that's never set) — exercises the CLI's
 * credential-gating: this file's suite should be reported as skipped, never
 * as a failure.
 *
 * @module tests/fixtures/config-gated.eval
 */

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { LanguageModel } from "effect/ai";
import { Dataset, EvalFile, Runner } from "../../src/index.ts";
import { exactMatchMetric, languageModelTask } from "./_shared.ts";

const configGatedSuite = Runner.makeSuite({
  name: "config-gated-suite",
  dataset: Dataset.fromArray("greetings", ["Bonjour"]),
  task: languageModelTask("echo@config-gated-fixture"),
  metrics: [exactMatchMetric((evalCase) => evalCase.golden === evalCase.output)],
});

/** Never set in the test environment — its absence is what makes this file's layer fail with a `ConfigError`. */
const missingLayer = Layer.effect(
  LanguageModel.LanguageModel,
  Effect.gen(function* () {
    const apiKey = yield* Config.String("EFFECT_EVALS_FIXTURE_NEVER_SET_TOKEN");
    return yield* LanguageModel.make({
      generateText: () => Effect.succeed([{ type: "text" as const, text: apiKey }]),
      streamText: () => Stream.die("fixture: streamText is not used"),
    });
  }),
);

export default {
  suites: [configGatedSuite],
  layer: missingLayer,
} satisfies EvalFile.EvalFile<LanguageModel.LanguageModel, Config.ConfigError>;
