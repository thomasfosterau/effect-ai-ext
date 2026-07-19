/**
 * Test stub for the upstream `LanguageModel` service.
 *
 * The `fromLanguageModel` adapters draw a `LanguageModel` from context and call
 * `generateObject`. These helpers provide a hand-built `LanguageModel.Service`
 * layer whose `generateObject` returns a canned structured value (or fails),
 * so the adapter tests exercise the real prompt/validation path with no network.
 *
 * @module tests/unit/helpers/language-model
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AiError, LanguageModel } from "effect/unstable/ai";

/**
 * A `LanguageModel` layer whose `generateObject` resolves to the given value,
 * wrapped in a `GenerateObjectResponse`. `onCall` captures each request's
 * `prompt` and `objectName` for pass-through assertions.
 */
export const stubLanguageModel = (
  value: unknown,
  onCall?: (request: { readonly prompt: unknown; readonly objectName: unknown }) => void,
): Layer.Layer<LanguageModel.LanguageModel> =>
  Layer.succeed(
    LanguageModel.LanguageModel,
    LanguageModel.LanguageModel.of({
      generateObject: ((options: { prompt: unknown; objectName: unknown }) => {
        onCall?.({ prompt: options.prompt, objectName: options.objectName });
        return Effect.succeed(new LanguageModel.GenerateObjectResponse(value, []));
      }) as never,
      generateText: (() =>
        Effect.die(new Error("generateText not stubbed"))) as never,
      streamText: (() => {
        throw new Error("streamText not stubbed");
      }) as never,
    }),
  );

/** A `LanguageModel` layer whose `generateObject` fails with an `AiError`. */
export const failingLanguageModel = (): Layer.Layer<LanguageModel.LanguageModel> =>
  Layer.succeed(
    LanguageModel.LanguageModel,
    LanguageModel.LanguageModel.of({
      generateObject: (() =>
        Effect.fail(
          AiError.make({
            module: "test",
            method: "generateObject",
            reason: new AiError.UnknownError({ description: "stubbed failure" }),
          }),
        )) as never,
      generateText: (() =>
        Effect.die(new Error("generateText not stubbed"))) as never,
      streamText: (() => {
        throw new Error("streamText not stubbed");
      }) as never,
    }),
  );
