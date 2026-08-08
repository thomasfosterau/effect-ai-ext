/**
 * @copyright Thomas Foster
 *
 * A fixture `*.eval.ts` file for the CLI's end-to-end tests
 * (`tests/cli/run.test.ts`) and for manually exercising the real bin
 * (`node bin/effect-evals.js run tests/fixtures/sample.eval.ts`). One suite
 * whose task calls a stubbed `LanguageModel` — exercising the eval-file
 * contract's `layer` (providing a service beyond platform services) end to
 * end, with no network reached.
 *
 * @module tests/fixtures/sample.eval
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { LanguageModel } from "effect/unstable/ai";
import { Dataset, EvalFile, Runner } from "../../src/index.ts";
import { exactMatchMetric, languageModelTask } from "./_shared.ts";

const fixtureSuite = Runner.makeSuite({
  name: "fixture-greetings",
  dataset: Dataset.fromArray("greetings", ["Bonjour"]),
  task: languageModelTask("greet@fixture"),
  metrics: [exactMatchMetric((evalCase) => evalCase.output === "Hello")],
});

const stubLanguageModelLayer = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: () => Effect.succeed([{ type: "text" as const, text: "Hello" }]),
    streamText: () => Stream.die("fixture: streamText is not used"),
  }),
);

export default {
  suites: [fixtureSuite],
  layer: stubLanguageModelLayer,
} satisfies EvalFile.EvalFile<LanguageModel.LanguageModel>;
