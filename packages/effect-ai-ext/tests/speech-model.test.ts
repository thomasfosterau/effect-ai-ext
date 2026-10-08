/**
 * Unit tests for the `SpeechModel` abstraction (`src/SpeechModel.ts`).
 *
 * Both the one-shot (`generate`) and streaming (`stream`) surfaces are stubbed
 * at the `make` seam.
 *
 * @module tests/unit/speech-model
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AiError } from "effect/ai";
import {
  make,
  type ProviderOptions,
  type ProviderResponse,
  type Service,
} from "@thomasfosterau/effect-ai-ext/SpeechModel";
import { expectFailureInstanceOf, runTest } from "./helpers/effect";

const expectAiError = async <A>(program: Effect.Effect<A, AiError.AiError>): Promise<string> => {
  const failure = await expectFailureInstanceOf(program, AiError.AiError);
  return String(failure.message);
};

const makeStub = (
  generate: (options: ProviderOptions) => Effect.Effect<ProviderResponse, AiError.AiError>,
): Effect.Effect<{ readonly model: Service; readonly calls: ProviderOptions[] }> =>
  Effect.gen(function* () {
    const calls: ProviderOptions[] = [];
    const model = yield* make({
      generate: (options) => {
        calls.push(options);
        return generate(options);
      },
      stream: (options) => {
        calls.push(options);
        return Stream.fromArray([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
      },
    });
    return { model, calls };
  });

describe("SpeechModel", () => {
  it("returns the audio buffer, media type, and usage; passes options through", async () => {
    const { response, calls } = await runTest(
      Effect.gen(function* () {
        const { model, calls } = yield* makeStub(() =>
          Effect.succeed({
            audio: new Uint8Array([1, 2, 3]),
            mediaType: "audio/mpeg",
            usage: { inputCharacters: 5 },
          }),
        );
        const result = yield* model.generate({ text: "hello", voice: "nova", format: "mp3" });
        return { response: result, calls };
      }),
    );

    expect(Array.from(response.audio)).toEqual([1, 2, 3]);
    expect(response.mediaType).toBe("audio/mpeg");
    expect(response.usage.inputCharacters).toBe(5);
    expect(calls).toEqual([{ text: "hello", voice: "nova", format: "mp3", sampleRate: undefined }]);
  });

  it("fails with AiError when the provider returns empty audio", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub(() =>
          Effect.succeed({
            audio: new Uint8Array([]),
            mediaType: "audio/mpeg",
            usage: { inputCharacters: undefined },
          }),
        );
        return yield* model.generate({ text: "hello" });
      }),
    );

    expect(message).toContain("empty audio");
  });

  it("streams audio chunks through the streaming surface", async () => {
    const chunks = await runTest(
      Effect.gen(function* () {
        const { model } = yield* makeStub(() =>
          Effect.succeed({
            audio: new Uint8Array([1]),
            mediaType: "audio/mpeg",
            usage: { inputCharacters: undefined },
          }),
        );
        return yield* Stream.runCollect(model.stream({ text: "hi" }));
      }),
    );

    expect(chunks.map((chunk) => Array.from(chunk))).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("propagates provider failures as AiError", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub(() =>
          Effect.fail(
            AiError.make({
              module: "test",
              method: "generate",
              reason: new AiError.UnknownError({ description: "stubbed failure" }),
            }),
          ),
        );
        return yield* model.generate({ text: "hello" });
      }),
    );

    expect(message).toContain("stubbed failure");
  });
});
