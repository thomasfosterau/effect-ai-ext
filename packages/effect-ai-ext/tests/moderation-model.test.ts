/**
 * Unit tests for the `ModerationModel` abstraction (`src/ModerationModel.ts`)
 * and its `fromLanguageModel` adapter.
 *
 * @module tests/unit/moderation-model
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AiError, Response } from "effect/ai";
import {
  fromLanguageModel,
  make,
  type ProviderOptions,
  type ProviderResponse,
  type Service,
} from "@thomasfosterau/effect-ai-ext/ModerationModel";
import { expectFailureInstanceOf, runTest } from "./helpers/effect";
import { failingLanguageModel, stubLanguageModel } from "./helpers/language-model";

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
      moderate: (options) =>
        Effect.gen(function* () {
          if ("fail" in behaviour) {
            return yield* AiError.make({
              module: "test",
              method: "moderate",
              reason: new AiError.UnknownError({ description: "stubbed failure" }),
            });
          }
          calls.push(options);
          return behaviour.respond(options);
        }),
    });
    return { model, calls };
  });

describe("ModerationModel", () => {
  it("returns per-input results with usage propagated", async () => {
    const response = await runTest(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            results: [{ isFlagged: true, categories: { hate: 0.9, violence: 0.1 } }],
            usage: { inputTokens: 7 },
          }),
        });
        return yield* model.moderate({ inputs: ["nasty"] });
      }),
    );

    expect(response.results[0].isFlagged).toBe(true);
    expect(response.results[0].categories.hate).toBe(0.9);
    expect(response.usage.inputTokens).toBe(7);
  });

  it("returns an empty response for empty inputs without calling the provider", async () => {
    const { response, callCount } = await runTest(
      Effect.gen(function* () {
        const { model, calls } = yield* makeStub({
          respond: () => ({ results: [{ isFlagged: false, categories: {} }], usage: noUsage }),
        });
        const result = yield* model.moderate({ inputs: [] });
        return { response: result, callCount: calls.length };
      }),
    );

    expect(response.results).toEqual([]);
    expect(response.usage.inputTokens).toBeUndefined();
    expect(callCount).toBe(0);
  });

  it("fails with AiError when the result count does not match the input count", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({ results: [], usage: noUsage }),
        });
        return yield* model.moderate({ inputs: ["one"] });
      }),
    );

    expect(message).toContain("expected 1");
  });

  it("fails with AiError when a category score is out of the [0, 1] range", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            results: [{ isFlagged: true, categories: { hate: 1.5 } }],
            usage: noUsage,
          }),
        });
        return yield* model.moderate({ inputs: ["x"] });
      }),
    );

    expect(message).toContain("category 'hate'");
  });

  it("propagates provider failures as AiError", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({ fail: true });
        return yield* model.moderate({ inputs: ["x"] });
      }),
    );

    expect(message).toContain("stubbed failure");
  });

  it("passes the provider's flags and modelId through", async () => {
    const response = await runTest(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            results: [{ isFlagged: true, categories: { hate: 0.9 }, flags: { hate: true } }],
            usage: noUsage,
            modelId: "omni-moderation-2024-09-26",
          }),
        });
        return yield* model.moderate({ inputs: ["nasty"] });
      }),
    );

    expect(response.results[0].flags).toEqual({ hate: true });
    expect(response.modelId).toBe("omni-moderation-2024-09-26");
  });

  it("leaves flags and modelId undefined when the provider reports neither", async () => {
    const response = await runTest(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({ results: [{ isFlagged: false, categories: {} }], usage: noUsage }),
        });
        return yield* model.moderate({ inputs: ["fine"] });
      }),
    );

    expect(response.results[0].flags).toBeUndefined();
    expect(response.modelId).toBeUndefined();
  });

  it("hands a multimodal input to the provider unchanged, one result per input", async () => {
    const image = { type: "file", mediaType: "image/png", data: "iVBORw0KGgo=" } as const;
    const { response, calls } = await runTest(
      Effect.gen(function* () {
        const stub = yield* makeStub({
          respond: (options) => ({
            results: options.inputs.map(() => ({ isFlagged: false, categories: {} })),
            usage: noUsage,
          }),
        });
        const result = yield* stub.model.moderate({
          inputs: ["caption", [{ type: "text", text: "alt" }, image]],
        });
        return { response: result, calls: stub.calls };
      }),
    );

    expect(calls[0]?.inputs).toEqual(["caption", [{ type: "text", text: "alt" }, image]]);
    expect(response.results).toHaveLength(2);
  });

  it("fails with InvalidUserInputError on an empty part list without calling the provider", async () => {
    const { failure, callCount } = await runTest(
      Effect.gen(function* () {
        const { model, calls } = yield* makeStub({
          respond: () => ({ results: [], usage: noUsage }),
        });
        const result = yield* Effect.flip(model.moderate({ inputs: ["x", []] }));
        return { failure: result, callCount: calls.length };
      }),
    );

    expect(failure.reason._tag).toBe("InvalidUserInputError");
    expect(callCount).toBe(0);
  });

  describe("fromLanguageModel", () => {
    it("sends a multimodal batch as one user message whose parts carry each input", async () => {
      let captured: unknown;
      const image = { type: "file", mediaType: "image/jpeg", data: "data:image/jpeg;base64,/9j/" };
      await runTest(
        Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.moderate({ inputs: ["caption", [image]] });
        }).pipe(
          Effect.provide(
            stubLanguageModel(
              {
                results: [
                  { isFlagged: false, categories: {} },
                  { isFlagged: false, categories: {} },
                ],
              },
              (request) => {
                captured = request.prompt;
              },
            ),
          ),
        ),
      );

      expect(captured).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: expect.stringContaining("Inputs:") },
            { type: "text", text: '1. "caption"' },
            { type: "text", text: "2." },
            image,
          ],
        },
      ]);
    });

    it("keeps a text-only batch as a single prompt string", async () => {
      let captured: unknown;
      await runTest(
        Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.moderate({ inputs: ["a"] });
        }).pipe(
          Effect.provide(
            stubLanguageModel({ results: [{ isFlagged: false, categories: {} }] }, (request) => {
              captured = request.prompt;
            }),
          ),
        ),
      );

      expect(captured).toEqual(expect.stringContaining('1. "a"'));
    });

    it("reports the modelId the language model's response metadata names", async () => {
      const response = await runTest(
        Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.moderate({ inputs: ["a"] });
        }).pipe(
          Effect.provide(
            stubLanguageModel({ results: [{ isFlagged: false, categories: {} }] }, undefined, [
              Response.makePart("response-metadata", {
                id: undefined,
                modelId: "lm-2026-01-01",
                timestamp: undefined,
                request: undefined,
              }),
            ]),
          ),
        ),
      );

      expect(response.modelId).toBe("lm-2026-01-01");
      expect(response.results[0].flags).toBeUndefined();
    });

    it("moderates via structured output and reuses the validation path", async () => {
      let captured: { readonly prompt: unknown; readonly objectName: unknown } | undefined;
      const response = await runTest(
        Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.moderate({ inputs: ["some text"] });
        }).pipe(
          Effect.provide(
            stubLanguageModel(
              { results: [{ isFlagged: false, categories: { hate: 0.01 } }] },
              (request) => {
                captured = request;
              },
            ),
          ),
        ),
      );

      expect(response.results[0].isFlagged).toBe(false);
      expect(response.results[0].categories.hate).toBe(0.01);
      expect(captured?.objectName).toBe("moderation");
    });

    it("asks the model for the wire name `flagged` and decodes it to `isFlagged`", async () => {
      const codecs: Array<Schema.Codec<unknown, unknown>> = [];
      await runTest(
        Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.moderate({ inputs: ["x"] });
        }).pipe(
          Effect.provide(
            stubLanguageModel({ results: [{ isFlagged: false, categories: {} }] }, (request) => {
              codecs.push(request.schema);
            }),
          ),
        ),
      );

      expect(codecs).toHaveLength(1);
      const [codec] = codecs;
      if (codec === undefined) return;
      const wire = { results: [{ flagged: true, categories: { hate: 0.5 } }] };
      expect(Schema.decodeUnknownSync(codec)(wire)).toEqual({
        results: [{ isFlagged: true, categories: { hate: 0.5 } }],
      });
      expect(
        Schema.encodeUnknownSync(codec)({ results: [{ isFlagged: false, categories: {} }] }),
      ).toEqual({
        results: [{ flagged: false, categories: {} }],
      });
    });

    it("surfaces a language-model failure as AiError", async () => {
      const message = await expectAiError(
        Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.moderate({ inputs: ["x"] });
        }).pipe(Effect.provide(failingLanguageModel())),
      );

      expect(message).toContain("stubbed failure");
    });

    it("validates language-model category scores", async () => {
      const message = await expectAiError(
        Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.moderate({ inputs: ["x"] });
        }).pipe(
          Effect.provide(
            stubLanguageModel({ results: [{ isFlagged: true, categories: { hate: 2 } }] }),
          ),
        ),
      );

      expect(message).toContain("category 'hate'");
    });
  });
});
