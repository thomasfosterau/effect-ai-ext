/**
 * Unit tests for the gateway-routed Cohere `EmbeddingModel` and
 * `RerankerModel` providers (`src/Cohere.ts`).
 *
 * The `AI` binding's `gateway(id).run(data, options)` is stubbed to
 * capture the outgoing universal-endpoint request and return a canned
 * Cohere v2 response, so the tests exercise request shape (provider,
 * endpoint, model, `output_dimension` pinning), response mapping, and
 * `AiError` failure paths without reaching the network.
 *
 * @module tests/unit/cohere
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { AiError } from "effect/ai";
import {
  COHERE_EMBEDDING_DIMENSIONS,
  COHERE_EMBEDDING_MODEL,
  COHERE_RERANK_MODEL,
  makeCohereEmbeddingModel,
  makeCohereReranker,
} from "@thomasfosterau/effect-ai-gateway";
import { expectFailureInstanceOf, runTest } from "./helpers/effect";

/**
 * Expected embedding width for `embed-v4.0`. In the website repo this test
 * pinned `COHERE_EMBEDDING_DIMENSIONS` against `@thomasfosterau/database`'s
 * `EMBEDDING_DIMENSIONS` (the `vector(n)` column width); this package stays
 * app-schema-agnostic, so it pins against a local literal instead — the
 * website keeps its own cross-package pin. See issue #1 (transfer).
 */
const EMBEDDING_DIMENSIONS = 1024;

/** Builds a stub `Ai` binding whose `gateway(id).run(data)` is canned. */
const stubAi = (response: { status: number; body: unknown }) => {
  const calls: unknown[] = [];
  const ai = {
    gateway: (_gatewayId: string) => ({
      run: async (data: unknown) => {
        calls.push(data);
        return new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      },
    }),
  } as unknown as Ai;
  return { ai, calls };
};

/** Builds a stub `Ai` binding whose `gateway(id).run(data)` rejects. */
const stubAiReject = (): Ai =>
  ({
    gateway: (_gatewayId: string) => ({
      run: async () => {
        throw new Error("gateway unreachable");
      },
    }),
  }) as unknown as Ai;

/** Builds a stub `Ai` binding whose `gateway(id).run(data)` returns a 200 response with an unparseable body. */
const stubAiMalformedBody = (): Ai =>
  ({
    gateway: (_gatewayId: string) => ({
      run: async () =>
        new Response("not valid json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    }),
  }) as unknown as Ai;

const binding = (ai: Ai) => ({ ai, gatewayId: "website" });

// ── Embeddings ───────────────────────────────────────────────────────

describe("Cohere embeddings", () => {
  it("pins output_dimension to the database's vector column width", () => {
    expect(COHERE_EMBEDDING_DIMENSIONS).toBe(EMBEDDING_DIMENSIONS);
  });

  it("posts the embed request with output_dimension pinned to 1024", async () => {
    const { ai, calls } = stubAi({
      status: 200,
      body: {
        embeddings: {
          float: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        },
        meta: { billed_units: { input_tokens: 5 } },
      },
    });

    const response = await runTest(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModel(binding(ai), {
          inputType: "search_document",
        });
        return yield* model.embedMany(["first", "second"]);
      }),
    );

    expect(calls).toEqual([
      {
        provider: "cohere",
        endpoint: "v2/embed",
        headers: { "content-type": "application/json" },
        query: {
          model: COHERE_EMBEDDING_MODEL,
          input_type: "search_document",
          texts: ["first", "second"],
          output_dimension: 1024,
          embedding_types: ["float"],
        },
      },
    ]);
    expect(response.embeddings.map((embedded) => [...embedded.vector])).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(response.usage.inputTokens).toBe(5);
  });

  it("forwards search_query as the input type for query-time embeddings", async () => {
    const { ai, calls } = stubAi({
      status: 200,
      body: { embeddings: { float: [[0.5]] } },
    });

    await runTest(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModel(binding(ai), { inputType: "search_query" });
        return yield* model.embedMany(["query text"]);
      }),
    );

    expect((calls[0] as { query: { input_type: string } }).query.input_type).toBe("search_query");
  });

  it("does not call the provider for an empty input array", async () => {
    const { ai, calls } = stubAi({ status: 200, body: { embeddings: { float: [] } } });

    await runTest(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModel(binding(ai), {
          inputType: "search_document",
        });
        return yield* model.embedMany([]);
      }),
    );

    expect(calls).toHaveLength(0);
  });

  it("fails with AiError on a non-2xx status", async () => {
    const { ai } = stubAi({ status: 401, body: { message: "invalid api key" } });

    const failure = await expectFailureInstanceOf(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModel(binding(ai), {
          inputType: "search_document",
        });
        return yield* model.embedMany(["text"]);
      }),
      AiError.AiError,
    );

    expect(failure.reason._tag).toBe("AuthenticationError");
  });

  it("fails with AiError when the response body has the wrong shape", async () => {
    const { ai } = stubAi({ status: 200, body: { unexpected: "shape" } });

    const failure = await expectFailureInstanceOf(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModel(binding(ai), {
          inputType: "search_document",
        });
        return yield* model.embedMany(["text"]);
      }),
      AiError.AiError,
    );

    expect(String(failure.message)).toContain("expected shape");
  });

  it("fails with AiError when the response body cannot be parsed as JSON", async () => {
    const failure = await expectFailureInstanceOf(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModel(binding(stubAiMalformedBody()), {
          inputType: "search_document",
        });
        return yield* model.embedMany(["text"]);
      }),
      AiError.AiError,
    );

    expect(String(failure.message)).toContain("response body");
  });

  it("fails with AiError (not a defect) when the gateway binding call rejects", async () => {
    const failure = await expectFailureInstanceOf(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModel(binding(stubAiReject()), {
          inputType: "search_document",
        });
        return yield* model.embedMany(["text"]);
      }),
      AiError.AiError,
    );

    expect(String(failure.message)).toContain("gateway call failed");
  });
});

// ── Reranking ────────────────────────────────────────────────────────

describe("Cohere reranker", () => {
  it("posts the rerank request and maps results by descending relevance", async () => {
    const { ai, calls } = stubAi({
      status: 200,
      body: {
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.2 },
        ],
        meta: { billed_units: { search_units: 1 } },
      },
    });

    const response = await runTest(
      Effect.gen(function* () {
        const reranker = yield* makeCohereReranker(binding(ai));
        return yield* reranker.rerank({
          query: "needle",
          documents: ["hay", "needle-adjacent"],
          topN: 2,
        });
      }),
    );

    expect(calls).toEqual([
      {
        provider: "cohere",
        endpoint: "v2/rerank",
        headers: { "content-type": "application/json" },
        query: {
          model: COHERE_RERANK_MODEL,
          query: "needle",
          documents: ["hay", "needle-adjacent"],
          top_n: 2,
        },
      },
    ]);
    expect(response.results.map((result) => result.index)).toEqual([1, 0]);
    expect(response.results[0]?.relevanceScore).toBe(0.9);
    expect(response.usage.inputTokens).toBe(1);
  });

  it("omits top_n when topN is not given", async () => {
    const { ai, calls } = stubAi({
      status: 200,
      body: { results: [{ index: 0, relevance_score: 1 }] },
    });

    await runTest(
      Effect.gen(function* () {
        const reranker = yield* makeCohereReranker(binding(ai));
        return yield* reranker.rerank({ query: "q", documents: ["only"] });
      }),
    );

    expect(calls[0]).not.toHaveProperty("query.top_n");
  });

  it("fails with AiError on a non-2xx status", async () => {
    const { ai } = stubAi({ status: 429, body: { message: "rate limited" } });

    const failure = await expectFailureInstanceOf(
      Effect.gen(function* () {
        const reranker = yield* makeCohereReranker(binding(ai));
        return yield* reranker.rerank({ query: "q", documents: ["a", "b"] });
      }),
      AiError.AiError,
    );

    expect(failure.reason._tag).toBe("RateLimitError");
  });

  it("fails with AiError (not a defect) when the gateway binding call rejects", async () => {
    const failure = await expectFailureInstanceOf(
      Effect.gen(function* () {
        const reranker = yield* makeCohereReranker(binding(stubAiReject()));
        return yield* reranker.rerank({ query: "q", documents: ["a", "b"] });
      }),
      AiError.AiError,
    );

    expect(String(failure.message)).toContain("gateway call failed");
  });
});
