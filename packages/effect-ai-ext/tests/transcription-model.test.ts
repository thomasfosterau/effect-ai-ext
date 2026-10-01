/**
 * Unit tests for the `TranscriptionModel` abstraction
 * (`src/TranscriptionModel.ts`). The provider is stubbed at the `make` seam.
 *
 * @module tests/unit/transcription-model
 */

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { AiError } from "effect/ai";
import {
  make,
  type ProviderOptions,
  type ProviderResponse,
  type Service,
} from "@thomasfosterau/effect-ai-ext/TranscriptionModel";
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
      transcribe: (options) =>
        Effect.gen(function* () {
          if ("fail" in behaviour) {
            return yield* AiError.make({
              module: "test",
              method: "transcribe",
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

describe("TranscriptionModel", () => {
  it("returns text, segments, language, and usage; passes options through", async () => {
    const { response, calls } = await runTest(
      Effect.gen(function* () {
        const { model, calls } = yield* makeStub({
          respond: () => ({
            text: "hello world",
            segments: [
              { text: "hello", start: 0, end: 0.5 },
              { text: "world", start: 0.5, end: 1 },
            ],
            language: "en",
            usage: { durationSeconds: 1 },
          }),
        });
        const result = yield* model.transcribe({ audio, mediaType: "audio/wav", language: "en" });
        return { response: result, calls };
      }),
    );

    expect(response.text).toBe("hello world");
    expect(response.segments?.length).toBe(2);
    expect(response.language).toBe("en");
    expect(response.usage.durationSeconds).toBe(1);
    expect(calls).toEqual([{ audio, mediaType: "audio/wav", language: "en" }]);
  });

  it("returns undefined segments and language when the provider omits them", async () => {
    const response = await runTest(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            text: "bare",
            segments: undefined,
            language: undefined,
            usage: { durationSeconds: undefined },
          }),
        });
        return yield* model.transcribe({ audio });
      }),
    );

    expect(response.segments).toBeUndefined();
    expect(response.language).toBeUndefined();
  });

  it("fails with AiError when a segment ends before it starts", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            text: "x",
            segments: [{ text: "x", start: 1, end: 0.5 }],
            language: undefined,
            usage: { durationSeconds: undefined },
          }),
        });
        return yield* model.transcribe({ audio });
      }),
    );

    expect(message).toContain("before it starts");
  });

  it("fails with AiError when a segment has non-finite timestamps", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            text: "x",
            segments: [{ text: "x", start: 0, end: Number.NaN }],
            language: undefined,
            usage: { durationSeconds: undefined },
          }),
        });
        return yield* model.transcribe({ audio });
      }),
    );

    expect(message).toContain("non-finite");
  });

  it("propagates provider failures as AiError", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({ fail: true });
        return yield* model.transcribe({ audio });
      }),
    );

    expect(message).toContain("stubbed failure");
  });
});
