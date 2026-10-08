/**
 * Unit tests for the first-party Voyage AI Effect AI provider
 * (`src/VoyageClient.ts`, `src/VoyageEmbeddingModel.ts`,
 * `src/VoyageRerankerModel.ts`).
 *
 * The network is stubbed at `FetchHttpClient.Fetch` — the same technique the
 * Mistral package's tests use. Each stub captures the outgoing request (URL,
 * `authorization` header, JSON body) and returns a canned Voyage response, so
 * the tests exercise request construction and response decoding without
 * reaching the network. No live key or live network is involved.
 *
 * @module tests/voyage
 */

import { describe, expect, it } from "vite-plus/test";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { AiError, EmbeddingModel } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RerankerModel } from "@thomasfosterau/effect-ai-ext";
import {
  VoyageClient,
  VoyageEmbeddingModel,
  VoyageRerankerModel,
} from "@thomasfosterau/effect-ai-voyage";
import { expectFailureInstanceOf, runTest } from "./helpers/effect";

// ── Fetch stubbing ────────────────────────────────────────────────────

interface CapturedRequest {
  readonly url: string;
  readonly authorization: string | null;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

const makeFetch = (respond: (captured: CapturedRequest) => Response) => {
  const calls: Array<CapturedRequest> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as Record<string, unknown>;
    const captured: CapturedRequest = {
      url: request.url,
      authorization: request.headers.get("authorization"),
      headers: Object.fromEntries(request.headers),
      body,
    };
    calls.push(captured);
    return respond(captured);
  };
  return { calls, fetch };
};

const httpLayer = (fetch: typeof globalThis.fetch) =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)));

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const embeddingBody = (
  vectors: ReadonlyArray<ReadonlyArray<number>>,
  over?: Record<string, unknown>,
) => ({
  object: "list",
  data: vectors.map((embedding, index) => ({ object: "embedding", embedding, index })),
  model: "voyage-3-large",
  usage: { total_tokens: 10 },
  ...over,
});

const rerankBody = (
  results: ReadonlyArray<{ index: number; relevance_score: number }>,
  over?: Record<string, unknown>,
) => ({
  object: "list",
  data: results.map((r) => ({ index: r.index, relevance_score: r.relevance_score })),
  model: "rerank-2.5",
  usage: { total_tokens: 26 },
  ...over,
});

// ── Layers ────────────────────────────────────────────────────────────

const embeddingLayer = (
  fetch: typeof globalThis.fetch,
  options?: {
    readonly apiKey?: Redacted.Redacted<string>;
    readonly model?: VoyageEmbeddingModel.Options;
  },
) =>
  VoyageEmbeddingModel.layer(options?.model ?? { model: "voyage-3-large" }).pipe(
    Layer.provide(VoyageClient.layer({ apiKey: options?.apiKey ?? Redacted.make("test-key") })),
    Layer.provide(httpLayer(fetch)),
  );

const rerankerLayer = (
  fetch: typeof globalThis.fetch,
  options?: {
    readonly apiKey?: Redacted.Redacted<string>;
    readonly model?: VoyageRerankerModel.Options;
  },
) =>
  VoyageRerankerModel.layer(options?.model ?? { model: "rerank-2.5" }).pipe(
    Layer.provide(VoyageClient.layer({ apiKey: options?.apiKey ?? Redacted.make("test-key") })),
    Layer.provide(httpLayer(fetch)),
  );

const embedMany = (inputs: ReadonlyArray<string>) =>
  Effect.flatMap(EmbeddingModel.EmbeddingModel, (model) => model.embedMany(inputs));

const embed = (input: string) =>
  Effect.flatMap(EmbeddingModel.EmbeddingModel, (model) => model.embed(input));

const rerank = (options: RerankerModel.RerankOptions) =>
  Effect.flatMap(RerankerModel.RerankerModel, (model) => model.rerank(options));

// ── Embeddings ────────────────────────────────────────────────────────

describe("VoyageEmbeddingModel", () => {
  it("posts to the embeddings endpoint with a bearer token and decodes vectors", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(
        embeddingBody([
          [0.1, 0.2],
          [0.3, 0.4],
        ]),
      ),
    );

    const response = await runTest(
      embedMany(["a", "b"]).pipe(Effect.provide(embeddingLayer(fetch))),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(calls[0]?.authorization).toBe("Bearer test-key");
    expect(calls[0]?.body.model).toBe("voyage-3-large");
    expect(calls[0]?.body.input).toEqual(["a", "b"]);
    expect(response.embeddings.map((e) => e.vector)).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(response.usage.inputTokens).toBe(10);
  });

  it("threads inputType and outputDimension into the request", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.1]])));

    await runTest(
      embedMany(["doc"]).pipe(
        Effect.provide(
          embeddingLayer(fetch, {
            model: { model: "voyage-3-large", inputType: "document", outputDimension: 256 },
          }),
        ),
      ),
    );

    expect(calls[0]?.body.input_type).toBe("document");
    expect(calls[0]?.body.output_dimension).toBe(256);
  });

  it("omits input_type and output_dimension when unset", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.1]])));

    await runTest(embedMany(["x"]).pipe(Effect.provide(embeddingLayer(fetch))));

    expect(calls[0]?.body).not.toHaveProperty("input_type");
    expect(calls[0]?.body).not.toHaveProperty("output_dimension");
  });

  it("reorders decoded vectors by their reported index", async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse({
        object: "list",
        data: [
          { object: "embedding", embedding: [0.2], index: 1 },
          { object: "embedding", embedding: [0.1], index: 0 },
        ],
        model: "voyage-3-large",
        usage: { total_tokens: 4 },
      }),
    );

    const response = await runTest(
      embedMany(["a", "b"]).pipe(Effect.provide(embeddingLayer(fetch))),
    );

    expect(response.embeddings.map((e) => e.vector)).toEqual([[0.1], [0.2]]);
  });

  it("embeds a single input via the request resolver", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.5, 0.6]])));

    const response = await runTest(embed("solo").pipe(Effect.provide(embeddingLayer(fetch))));

    expect(response.vector).toEqual([0.5, 0.6]);
    expect(calls[0]?.body.input).toEqual(["solo"]);
  });

  it("returns an empty response for embedMany([]) without calling Voyage", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([])));

    const response = await runTest(embedMany([]).pipe(Effect.provide(embeddingLayer(fetch))));

    expect(response.embeddings).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("omits the authorization header when constructed without an API key", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.1]])));

    await runTest(
      embedMany(["x"]).pipe(
        Effect.provide(
          VoyageEmbeddingModel.layer({ model: "voyage-3.5" }).pipe(
            Layer.provide(VoyageClient.layer({})),
            Layer.provide(httpLayer(fetch)),
          ),
        ),
      ),
    );

    expect(calls[0]?.authorization).toBeNull();
  });

  it("maps a non-2xx status to an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse({ detail: "rate limited" }, 429));

    await expectFailureInstanceOf(
      embedMany(["x"]).pipe(Effect.provide(embeddingLayer(fetch))),
      AiError.AiError,
    );
  });

  it("maps an undecodable success body to an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse({ not: "an embeddings response" }));

    await expectFailureInstanceOf(
      embedMany(["x"]).pipe(Effect.provide(embeddingLayer(fetch))),
      AiError.AiError,
    );
  });

  it("maps a success body that is not JSON at all to an InvalidOutputError", async () => {
    const { fetch } = makeFetch(
      () =>
        new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    );

    const error = await expectFailureInstanceOf(
      embedMany(["x"]).pipe(Effect.provide(embeddingLayer(fetch))),
      AiError.AiError,
    );
    expect(error.reason._tag).toBe("InvalidOutputError");
  });
});

// ── apiUrl override (BYOK routing contract) ───────────────────────────

describe("VoyageClient apiUrl override", () => {
  it("routes requests through the overridden base URL", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.1]])));

    await runTest(
      embedMany(["x"]).pipe(
        Effect.provide(
          VoyageEmbeddingModel.layer({ model: "voyage-3-large" }).pipe(
            Layer.provide(
              VoyageClient.layer({
                apiKey: Redacted.make("gw-key"),
                apiUrl: "https://gateway.example/voyage",
              }),
            ),
            Layer.provide(httpLayer(fetch)),
          ),
        ),
      ),
    );

    expect(calls[0]?.url).toBe("https://gateway.example/voyage/v1/embeddings");
    expect(calls[0]?.authorization).toBe("Bearer gw-key");
  });

  it("loads apiUrl and apiKey through a Config-driven client layer", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(rerankBody([{ index: 0, relevance_score: 0.9 }])),
    );

    const clientLayer = VoyageClient.layerConfig({
      apiKey: Config.succeed(Redacted.make("cfg-key")),
      apiUrl: Config.succeed("https://proxy.example"),
    });

    await runTest(
      rerank({ query: "q", documents: ["d"] }).pipe(
        Effect.provide(
          VoyageRerankerModel.layer({ model: "rerank-2.5" }).pipe(
            Layer.provide(clientLayer),
            Layer.provide(httpLayer(fetch)),
          ),
        ),
      ),
    );

    expect(calls[0]?.url).toBe("https://proxy.example/v1/rerank");
    expect(calls[0]?.authorization).toBe("Bearer cfg-key");
  });
});

// ── Reranking ─────────────────────────────────────────────────────────

describe("VoyageRerankerModel", () => {
  it("posts to the rerank endpoint, maps topN to top_k, and sorts by relevance", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(
        rerankBody([
          { index: 0, relevance_score: 0.2 },
          { index: 2, relevance_score: 0.9 },
        ]),
      ),
    );

    const response = await runTest(
      rerank({ query: "what is effect?", documents: ["a", "b", "c"], topN: 2 }).pipe(
        Effect.provide(rerankerLayer(fetch)),
      ),
    );

    expect(calls[0]?.url).toBe("https://api.voyageai.com/v1/rerank");
    expect(calls[0]?.body.model).toBe("rerank-2.5");
    expect(calls[0]?.body.query).toBe("what is effect?");
    expect(calls[0]?.body.documents).toEqual(["a", "b", "c"]);
    expect(calls[0]?.body.top_k).toBe(2);
    expect(response.results.map((r) => r.index)).toEqual([2, 0]);
    expect(response.results[0]?.relevanceScore).toBe(0.9);
    expect(response.usage.inputTokens).toBe(26);
  });

  it("omits top_k when topN is unset", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(rerankBody([{ index: 0, relevance_score: 0.5 }])),
    );

    await runTest(
      rerank({ query: "q", documents: ["a"] }).pipe(Effect.provide(rerankerLayer(fetch))),
    );

    expect(calls[0]?.body).not.toHaveProperty("top_k");
  });

  it("short-circuits an empty documents array without calling Voyage", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(rerankBody([])));

    const response = await runTest(
      rerank({ query: "q", documents: [] }).pipe(Effect.provide(rerankerLayer(fetch))),
    );

    expect(response.results).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("fails with an AiError when the provider returns an out-of-range index", async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(rerankBody([{ index: 5, relevance_score: 0.5 }])),
    );

    await expectFailureInstanceOf(
      rerank({ query: "q", documents: ["a", "b"] }).pipe(Effect.provide(rerankerLayer(fetch))),
      AiError.AiError,
    );
  });

  it("maps a non-2xx status to an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse({ detail: "bad request" }, 400));

    await expectFailureInstanceOf(
      rerank({ query: "q", documents: ["a"] }).pipe(Effect.provide(rerankerLayer(fetch))),
      AiError.AiError,
    );
  });

  it("maps an undecodable success body to an InvalidOutputError", async () => {
    const { fetch } = makeFetch(() => jsonResponse({ not: "a rerank response" }));

    const error = await expectFailureInstanceOf(
      rerank({ query: "q", documents: ["a"] }).pipe(Effect.provide(rerankerLayer(fetch))),
      AiError.AiError,
    );
    expect(error.reason._tag).toBe("InvalidOutputError");
  });
});

// ── Client-level behaviour ────────────────────────────────────────────

describe("VoyageClient", () => {
  it("maps a transport failure to an AiError", async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new TypeError("network down");
    };

    await expectFailureInstanceOf(
      embedMany(["x"]).pipe(Effect.provide(embeddingLayer(fetch))),
      AiError.AiError,
    );
  });

  it("applies a transformClient to outgoing requests", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.1]])));

    await runTest(
      embedMany(["x"]).pipe(
        Effect.provide(
          VoyageEmbeddingModel.layer({ model: "voyage-3-large" }).pipe(
            Layer.provide(
              VoyageClient.layer({
                apiKey: Redacted.make("k"),
                transformClient: (client) =>
                  HttpClient.mapRequest(client, HttpClientRequest.setHeader("x-test", "1")),
              }),
            ),
            Layer.provide(httpLayer(fetch)),
          ),
        ),
      ),
    );

    expect(calls[0]?.headers["x-test"]).toBe("1");
  });
});

// ── Model / dimension matrix ──────────────────────────────────────────

describe("VoyageEmbeddingModel.EMBEDDING_MODELS", () => {
  it("documents Matryoshka models with four selectable dimensions and a 1024 default", async () => {
    for (const id of [
      "voyage-3-large",
      "voyage-3.5",
      "voyage-3.5-lite",
      "voyage-code-3",
    ] as const) {
      const info = VoyageEmbeddingModel.EMBEDDING_MODELS[id];
      expect(info.defaultDimension).toBe(1024);
      expect(info.dimensions).toEqual([256, 512, 1024, 2048]);
    }
  });

  it("documents fixed-dimension models with a single dimension entry", async () => {
    expect(VoyageEmbeddingModel.EMBEDDING_MODELS["voyage-code-2"].defaultDimension).toBe(1536);
    expect(VoyageEmbeddingModel.EMBEDDING_MODELS["voyage-3-lite"].defaultDimension).toBe(512);
    for (const info of Object.values(VoyageEmbeddingModel.EMBEDDING_MODELS)) {
      expect(info.dimensions).toContain(info.defaultDimension);
    }
  });

  it("resolves a known model's default dimension and undefined for an unknown id", async () => {
    expect(VoyageEmbeddingModel.defaultDimension("voyage-3-large")).toBe(1024);
    expect(VoyageEmbeddingModel.defaultDimension("nonexistent-model")).toBeUndefined();
  });
});
