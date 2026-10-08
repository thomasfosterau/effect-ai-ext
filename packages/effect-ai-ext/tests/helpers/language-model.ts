/**
 * Test stub for the upstream `LanguageModel` service.
 *
 * The `fromLanguageModel` adapters draw a `LanguageModel` from context and call
 * `generateObject`. These helpers provide a hand-built `LanguageModel` service
 * layer whose `generateObject` returns a canned structured value (or fails),
 * so the adapter tests exercise the real prompt/validation path with no network.
 *
 * @module tests/unit/helpers/language-model
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schema from "effect/Schema";
import { AiError, LanguageModel } from "effect/ai";

/**
 * A `LanguageModel` layer whose `generateObject` resolves to the given value,
 * wrapped in a `GenerateObjectResponse`. `onCall` captures each request's
 * `prompt`, `objectName` and `schema` for pass-through assertions (the
 * schema lets a test decode a raw wire payload the way a real
 * `LanguageModel` would).
 */
export const stubLanguageModel = (
  value: unknown,
  onCall?: (request: {
    readonly prompt: unknown;
    readonly objectName: unknown;
    readonly schema: Schema.Codec<unknown, unknown>;
  }) => void,
): Layer.Layer<LanguageModel.LanguageModel> =>
  Layer.succeed(
    LanguageModel.LanguageModel,
    LanguageModel.LanguageModel.of({
      generateObject: ((options: {
        prompt: unknown;
        objectName: unknown;
        schema: Schema.Codec<unknown, unknown>;
      }) => {
        onCall?.({
          prompt: options.prompt,
          objectName: options.objectName,
          schema: options.schema,
        });
        return Effect.succeed(new LanguageModel.GenerateObjectResponse(value, []));
      }) as never,
      generateText: (() => Effect.die(new Error("generateText not stubbed"))) as never,
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
      generateText: (() => Effect.die(new Error("generateText not stubbed"))) as never,
      streamText: (() => {
        throw new Error("streamText not stubbed");
      }) as never,
    }),
  );
