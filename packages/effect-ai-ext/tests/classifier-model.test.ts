/**
 * Unit tests for the `ClassifierModel` abstraction (`src/ClassifierModel.ts`)
 * and its `fromLanguageModel` adapter.
 *
 * The provider is stubbed at the `make` seam; the adapter is exercised over a
 * hand-built `LanguageModel` layer returning a canned structured object. No
 * network is reached in either path.
 *
 * @module tests/unit/classifier-model
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { AiError } from "effect/ai";
import {
  ClassScore,
  fromLanguageModel,
  make,
  type ProviderOptions,
  type ProviderResponse,
  type Service,
} from "@thomasfosterau/effect-ai-ext/ClassifierModel";
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
      classify: (options) =>
        Effect.gen(function* () {
          if ("fail" in behaviour) {
            return yield* AiError.make({
              module: "test",
              method: "classify",
              reason: new AiError.UnknownError({ description: "stubbed failure" }),
            });
          }
          calls.push(options);
          return behaviour.respond(options);
        }),
    });
    return { model, calls };
  });

describe("ClassifierModel", () => {
  it("returns classes sorted by descending score with usage propagated", async () => {
    const response = await runTest(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            classifications: [
              {
                classes: [
                  { label: "spam", score: 0.2 },
                  { label: "ham", score: 0.8 },
                ],
              },
            ],
            usage: { inputTokens: 11 },
          }),
        });
        return yield* model.classify({ inputs: ["hello"] });
      }),
    );

    expect(response.classifications[0].classes).toEqual([
      new ClassScore({ label: "ham", score: 0.8 }),
      new ClassScore({ label: "spam", score: 0.2 }),
    ]);
    expect(response.usage.inputTokens).toBe(11);
  });

  it("passes normalised provider options through (multiLabel defaults to false)", async () => {
    const calls = await runTest(
      Effect.gen(function* () {
        const { model, calls } = yield* makeStub({
          respond: () => ({
            classifications: [{ classes: [{ label: "a", score: 1 }] }],
            usage: noUsage,
          }),
        });
        yield* model.classify({ inputs: ["x"], labels: ["a", "b"] });
        return calls;
      }),
    );

    expect(calls).toEqual([
      { inputs: ["x"], labels: ["a", "b"], multiLabel: false, examples: undefined },
    ]);
  });

  it("returns an empty response for empty inputs without calling the provider", async () => {
    const { response, callCount } = await runTest(
      Effect.gen(function* () {
        const { model, calls } = yield* makeStub({
          respond: () => ({ classifications: [], usage: { inputTokens: 1 } }),
        });
        const result = yield* model.classify({ inputs: [] });
        return { response: result, callCount: calls.length };
      }),
    );

    expect(response.classifications).toEqual([]);
    expect(response.usage.inputTokens).toBeUndefined();
    expect(callCount).toBe(0);
  });

  it("fails with AiError when the classification count does not match the input count", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({ classifications: [], usage: noUsage }),
        });
        return yield* model.classify({ inputs: ["one"] });
      }),
    );

    expect(message).toContain("expected 1");
  });

  it("fails with AiError when a returned label is outside the requested set", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            classifications: [{ classes: [{ label: "other", score: 0.9 }] }],
            usage: noUsage,
          }),
        });
        return yield* model.classify({ inputs: ["x"], labels: ["a", "b"] });
      }),
    );

    expect(message).toContain("'other'");
  });

  it("fails with AiError when a score is not finite", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            classifications: [{ classes: [{ label: "a", score: Number.POSITIVE_INFINITY }] }],
            usage: noUsage,
          }),
        });
        return yield* model.classify({ inputs: ["x"] });
      }),
    );

    expect(message).toContain("non-finite score");
  });

  it("propagates provider failures as AiError", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStub({ fail: true });
        return yield* model.classify({ inputs: ["x"] });
      }),
    );

    expect(message).toContain("stubbed failure");
  });

  describe("fromLanguageModel", () => {
    it("classifies via structured output and reuses the validation path", async () => {
      let captured: { readonly prompt: unknown; readonly objectName: unknown } | undefined;
      const response = await runTest(
        Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.classify({
            inputs: ["great product"],
            labels: ["positive", "negative"],
          });
        }).pipe(
          Effect.provide(
            stubLanguageModel(
              {
                classifications: [
                  {
                    classes: [
                      { label: "negative", score: 0.1 },
                      { label: "positive", score: 0.9 },
                    ],
                  },
                ],
              },
              (request) => {
                captured = request;
              },
            ),
          ),
        ),
      );

      expect(response.classifications[0].classes[0]).toEqual(
        new ClassScore({ label: "positive", score: 0.9 }),
      );
      expect(captured?.objectName).toBe("classification");
      expect(String(captured?.prompt)).toContain("positive, negative");
    });

    it("surfaces a language-model failure as AiError", async () => {
      const message = await expectAiError(
        Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.classify({ inputs: ["x"] });
        }).pipe(Effect.provide(failingLanguageModel())),
      );

      expect(message).toContain("stubbed failure");
    });

    it("validates language-model output against the requested labels", async () => {
      const message = await expectAiError(
        Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.classify({ inputs: ["x"], labels: ["a"] });
        }).pipe(
          Effect.provide(
            stubLanguageModel({
              classifications: [{ classes: [{ label: "bogus", score: 0.5 }] }],
            }),
          ),
        ),
      );

      expect(message).toContain("'bogus'");
    });
  });
});
