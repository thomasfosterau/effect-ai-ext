/**
 * Unit tests for the `RerankerModel` abstraction (`src/RerankerModel.ts`).
 *
 * The provider is stubbed at the `make` seam — the stub's `rerank` hook returns
 * canned provider results, so the tests exercise the real validation and
 * normalisation path while never reaching the network.
 *
 * @module tests/unit/reranker-model
 */

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { AiError } from "effect/unstable/ai";
import { RerankedDocument } from "@thomasfosterau/effect-ai-ext/RerankerModel";
import { expectFailureInstanceOf, runTest } from "./helpers/effect";
import { makeStubReranker as makeStubModel } from "./helpers/reranker";

const noUsage = { inputTokens: undefined } as const;

const expectAiError = async <A>(program: Effect.Effect<A, AiError.AiError>): Promise<string> => {
  const failure = await expectFailureInstanceOf(program, AiError.AiError);
  return String(failure.message);
};

const documents = ["alpha document", "bravo document", "charlie document"];

describe("RerankerModel", () => {
  it("returns results sorted by descending relevance with usage propagated", async () => {
    const response = await runTest(
      Effect.gen(function* () {
        const { model } = yield* makeStubModel({
          respond: () => ({
            results: [
              { index: 0, relevanceScore: 0.1 },
              { index: 2, relevanceScore: 0.9 },
              { index: 1, relevanceScore: 0.5 },
            ],
            usage: { inputTokens: 42 },
          }),
        });
        return yield* model.rerank({ query: "which is best?", documents });
      }),
    );

    expect(response.results).toEqual([
      new RerankedDocument({ index: 2, relevanceScore: 0.9 }),
      new RerankedDocument({ index: 1, relevanceScore: 0.5 }),
      new RerankedDocument({ index: 0, relevanceScore: 0.1 }),
    ]);
    expect(response.usage.inputTokens).toBe(42);
  });

  it("passes query, documents, and topN through to the provider", async () => {
    const calls = await runTest(
      Effect.gen(function* () {
        const { model, calls } = yield* makeStubModel({
          respond: () => ({ results: [{ index: 1, relevanceScore: 1 }], usage: noUsage }),
        });
        yield* model.rerank({ query: "needle", documents, topN: 1 });
        return calls;
      }),
    );

    expect(calls).toEqual([{ query: "needle", documents, topN: 1 }]);
  });

  it("returns an empty response for an empty documents array without calling the provider", async () => {
    const { response, callCount } = await runTest(
      Effect.gen(function* () {
        const { model, calls } = yield* makeStubModel({
          respond: () => ({ results: [], usage: { inputTokens: 1 } }),
        });
        const result = yield* model.rerank({ query: "anything", documents: [] });
        return { response: result, callCount: calls.length };
      }),
    );

    expect(response.results).toEqual([]);
    expect(response.usage.inputTokens).toBeUndefined();
    expect(callCount).toBe(0);
  });

  it("fails with AiError when the provider returns an out-of-range index", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStubModel({
          respond: () => ({ results: [{ index: 3, relevanceScore: 0.5 }], usage: noUsage }),
        });
        return yield* model.rerank({ query: "q", documents });
      }),
    );

    expect(message).toContain("index 3");
  });

  it("fails with AiError when the provider returns a non-integer index", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStubModel({
          respond: () => ({ results: [{ index: 0.5, relevanceScore: 0.5 }], usage: noUsage }),
        });
        return yield* model.rerank({ query: "q", documents });
      }),
    );

    expect(message).toContain("index 0.5");
  });

  it("fails with AiError when the provider returns a duplicate index", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStubModel({
          respond: () => ({
            results: [
              { index: 1, relevanceScore: 0.9 },
              { index: 1, relevanceScore: 0.4 },
            ],
            usage: noUsage,
          }),
        });
        return yield* model.rerank({ query: "q", documents });
      }),
    );

    expect(message).toContain("duplicate document index 1");
  });

  it("fails with AiError when the provider returns more results than topN", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStubModel({
          respond: () => ({
            results: [
              { index: 0, relevanceScore: 0.9 },
              { index: 1, relevanceScore: 0.4 },
            ],
            usage: noUsage,
          }),
        });
        return yield* model.rerank({ query: "q", documents, topN: 1 });
      }),
    );

    expect(message).toContain("at most 1");
  });

  it("propagates provider failures as AiError", async () => {
    const message = await expectAiError(
      Effect.gen(function* () {
        const { model } = yield* makeStubModel({ fail: true });
        return yield* model.rerank({ query: "q", documents });
      }),
    );

    expect(message).toContain("stubbed failure");
  });
});
