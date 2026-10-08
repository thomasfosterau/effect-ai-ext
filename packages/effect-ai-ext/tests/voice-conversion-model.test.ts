/**
 * Unit tests for the `VoiceConversionModel` abstraction
 * (`src/VoiceConversionModel.ts`). The provider is stubbed at the `make` seam.
 *
 * @module tests/unit/voice-conversion-model
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { AiError } from "effect/ai";
import {
  make,
  type ProviderOptions,
  type ProviderResponse,
  type Service,
} from "@thomasfosterau/effect-ai-ext/VoiceConversionModel";
import { expectFailureInstanceOf, runTest } from "./helpers/effect";

const expectAiError = async <A>(program: Effect.Effect<A, AiError.AiError>): Promise<string> => {
  const failure = await expectFailureInstanceOf(program, AiError.AiError);
  return String(failure.message);
};

const makeStub = (
  behaviour:
    | { readonly respond: (options: ProviderOptions) => ProviderResponse }
    | { readonly fail: true },
): Effect.Effect<{ readonly model: Service; readonly calls: ProviderOptions[] }> =>
  Effect.gen(function* () {
    const calls: ProviderOptions[] = [];
    const model = yield* make({
      convert: (options) =>
        Effect.gen(function* () {
          if ("fail" in behaviour) {
            return yield* AiError.make({
              module: "test",
              method: "convert",
              reason: new AiError.UnknownError({ description: "stubbed failure" }),
            });
          }
          calls.push(options);
          return behaviour.respond(options);
        }),
    });
    return { model, calls };
  });

const audio = new Uint8Array([1, 2, 3]);

describe("VoiceConversionModel", () => {
  it("returns the converted audio, media type, and usage; passes options through", async () => {
    const { response, calls } = await runTest(
      Effect.gen(function* () {
        const { model, calls } = yield* makeStub({
          respond: () => ({
            audio: new Uint8Array([4, 5]),
            mediaType: "audio/mpeg",
            usage: { durationSeconds: 2 },
          }),
        });
        const result = yield* model.convert({ audio, targetVoice: "nova", format: "mp3" });
        return { response: result, calls };
      }),
    );

    expect(Array.from(response.audio)).toEqual([4, 5]);
    expect(response.mediaType).toBe("audio/mpeg");
    expect(response.usage.durationSeconds).toBe(2);
    expect(calls).toEqual([{ audio, targetVoice: "nova", format: "mp3" }]);
  });

  it("fails with AiError when the provider returns empty audio", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            audio: new Uint8Array([]),
            mediaType: "audio/mpeg",
            usage: { durationSeconds: undefined },
          }),
        });
        return yield* model.convert({ audio, targetVoice: "nova" });
      }),
    );

    expect(message).toContain("empty audio");
  });

  it("propagates provider failures as AiError", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({ fail: true });
        return yield* model.convert({ audio, targetVoice: "nova" });
      }),
    );

    expect(message).toContain("stubbed failure");
  });
});
