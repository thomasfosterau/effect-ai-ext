/**
 * Unit tests for `EmbeddingSimilarity.embeddingSimilarity`. `EmbeddingModel`
 * lives in `R`, so these stub the service directly with `EmbeddingModel.make`
 * (no provider — the package takes no provider dependency; the Cohere layer
 * is wired at call sites in #931).
 *
 * @module tests/scorers/embedding-similarity
 */

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AiError, EmbeddingModel } from "effect/ai";
import { EmbeddingSimilarity } from "../../src/index.ts";
import { expectFailureInstanceOf, runTest } from "../helpers/effect.ts";

/** Stubs `EmbeddingModel` to return a fixed vector per input text, recording every `embedMany` call. */
const stubEmbeddingModel = (vectors: Record<string, ReadonlyArray<number>>) => {
  const calls: ReadonlyArray<string>[] = [];
  const layer = Layer.effect(
    EmbeddingModel.EmbeddingModel,
    EmbeddingModel.make({
      embedMany: ({ inputs }) => {
        calls.push(inputs);
        return Effect.succeed({
          results: inputs.map((input) => [...(vectors[input] ?? [])]),
          usage: { inputTokens: undefined },
        });
      },
    }),
  );
  return { layer, calls };
};

const failingEmbeddingModel = Layer.effect(
  EmbeddingModel.EmbeddingModel,
  EmbeddingModel.make({
    embedMany: () =>
      Effect.fail(
        AiError.make({
          module: "Test",
          method: "embedMany",
          reason: new AiError.UnknownError({ description: "provider unreachable" }),
        }),
      ),
  }),
);

describe("EmbeddingSimilarity.embeddingSimilarity", () => {
  it("scores 1 for identical-direction vectors", async () => {
    const { layer, calls } = stubEmbeddingModel({ same: [1, 0] });

    const score = await runTest(
      EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: { expected: "same" }, output: "same" })
        .pipe(Effect.provide(layer)),
    );

    expect(score.score).toBeCloseTo(1);
    expect(calls).toEqual([["same", "same"]]);
  });

  it("scores 0.5 for orthogonal vectors", async () => {
    const { layer } = stubEmbeddingModel({ output: [1, 0], expected: [0, 1] });

    const score = await runTest(
      EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: { expected: "expected" }, output: "output" })
        .pipe(Effect.provide(layer)),
    );

    expect(score.score).toBeCloseTo(0.5);
  });

  it("scores 0 for opposite-direction vectors, clamped at the floor", async () => {
    const { layer } = stubEmbeddingModel({ output: [1, 0], expected: [-1, 0] });

    const score = await runTest(
      EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: { expected: "expected" }, output: "output" })
        .pipe(Effect.provide(layer)),
    );

    expect(score.score).toBeCloseTo(0);
  });

  it("embeds output and expected together, in that order", async () => {
    const { layer, calls } = stubEmbeddingModel({ hello: [1, 1], world: [1, -1] });

    await runTest(
      EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: { expected: "world" }, output: "hello" })
        .pipe(Effect.provide(layer)),
    );

    expect(calls).toEqual([["hello", "world"]]);
  });

  it("scores 0 without calling the model when golden has no expected output", async () => {
    const { layer, calls } = stubEmbeddingModel({});

    const score = await runTest(
      EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: {}, output: "anything" })
        .pipe(Effect.provide(layer)),
    );

    expect(score).toEqual({ score: 0, reason: "golden.expected is undefined" });
    expect(calls).toHaveLength(0);
  });

  it("surfaces the model's typed AiError rather than throwing", async () => {
    await expectFailureInstanceOf(
      EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: { expected: "expected" }, output: "output" })
        .pipe(Effect.provide(failingEmbeddingModel), Effect.asVoid),
      AiError.AiError,
    );
  });
});
