/**
 * Unit tests for the `ImageModel` abstraction (`src/ImageModel.ts`). The
 * provider is stubbed at the `make` seam.
 *
 * @module tests/unit/image-model
 */

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { AiError } from "effect/ai";
import {
  ImagePart,
  make,
  type ProviderOptions,
  type ProviderResponse,
  type Service,
} from "@thomasfosterau/effect-ai-ext/ImageModel";
import { expectFailureInstanceOf, runTest } from "./helpers/effect";

const noUsage = { inputTokens: undefined } as const;

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
      generate: (options) =>
        Effect.gen(function* () {
          if ("fail" in behaviour) {
            return yield* AiError.make({
              module: "test",
              method: "generate",
              reason: new AiError.UnknownError({ description: "stubbed failure" }),
            });
          }
          calls.push(options);
          return behaviour.respond(options);
        }),
    });
    return { model, calls };
  });

describe("ImageModel", () => {
  it("returns image parts (base64 and bytes) with usage; passes options through", async () => {
    const bytes = new Uint8Array([9, 9]);
    const { response, calls } = await runTest(
      Effect.gen(function* () {
        const { model, calls } = yield* makeStub({
          respond: () => ({
            images: [
              { data: "aGVsbG8=", mediaType: "image/png" },
              { data: bytes, mediaType: "image/jpeg" },
            ],
            usage: { inputTokens: 3 },
          }),
        });
        const result = yield* model.generate({ prompt: "a cat", size: "512x512", count: 2 });
        return { response: result, calls };
      }),
    );

    expect(response.images).toEqual([
      new ImagePart({ data: "aGVsbG8=", mediaType: "image/png" }),
      new ImagePart({ data: bytes, mediaType: "image/jpeg" }),
    ]);
    expect(response.usage.inputTokens).toBe(3);
    expect(calls).toEqual([
      { prompt: "a cat", size: "512x512", format: undefined, count: 2 },
    ]);
  });

  it("fails with AiError when the provider returns no images", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({ images: [], usage: noUsage }),
        });
        return yield* model.generate({ prompt: "empty" });
      }),
    );

    expect(message).toContain("no images");
  });

  it("fails with AiError when the provider returns more images than requested", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            images: [
              { data: "a", mediaType: "image/png" },
              { data: "b", mediaType: "image/png" },
            ],
            usage: noUsage,
          }),
        });
        return yield* model.generate({ prompt: "two", count: 1 });
      }),
    );

    expect(message).toContain("at most 1");
  });

  it("propagates provider failures as AiError", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({ fail: true });
        return yield* model.generate({ prompt: "x" });
      }),
    );

    expect(message).toContain("stubbed failure");
  });
});
