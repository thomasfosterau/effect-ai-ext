/**
 * Unit tests for the binding-free, URL-based Cohere `EmbeddingModel`
 * provider (`makeCohereEmbeddingModelFromUrl` in `src/Cohere.ts`).
 *
 * Config is supplied through `ConfigProvider.fromUnknown` instead of real
 * environment variables, and the network is stubbed at
 * `FetchHttpClient.Fetch` — so these tests exercise the resolved gateway
 * URL, the `cf-aig-authorization` header, request shape, and response
 * mapping without reaching the network or requiring a Worker `AI` binding.
 *
 * @module tests/unit/cohere-url
 */

import { describe, expect, it } from "vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AiError } from "effect/unstable/ai";
import { FetchHttpClient } from "effect/unstable/http";
import {
  COHERE_EMBEDDING_MODEL,
  makeCohereEmbeddingModelFromUrl,
} from "@thomasfosterau/effect-ai-gateway";
import { expectFailureInstanceOf, runTest, runTestExit } from "./helpers/effect";

interface CapturedRequest {
  readonly url: string;
  readonly cfAigAuthorizationHeader: string | null;
  readonly body: unknown;
}

const stubFetch = (response: { status: number; body: unknown }) => {
  const calls: CapturedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      cfAigAuthorizationHeader: request.headers.get("cf-aig-authorization"),
      body: await request.json(),
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  const layer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
  return { calls, layer };
};

/** A fetch stub that returns a 200 response whose body is not valid JSON. */
const stubFetchMalformedBody = () => {
  const fetch: typeof globalThis.fetch = async () =>
    new Response("not valid json", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const layer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
  return { layer };
};

/** A fetch stub that rejects, simulating a transport-level failure. */
const stubFetchReject = () => {
  const fetch: typeof globalThis.fetch = async () => {
    throw new Error("network unreachable");
  };
  const layer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
  return { layer };
};

const stubConfig = (values: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(values));

const GATEWAY_CONFIG = {
  CF_ACCOUNT_ID: "acct",
  CF_AIG_GATEWAY_ID: "website",
  CF_AIG_TOKEN: "test-token",
};

describe("makeCohereEmbeddingModelFromUrl", () => {
  it("posts the embed request to the config-resolved gateway URL with the cf-aig-authorization header", async () => {
    const { calls, layer: fetchLayer } = stubFetch({
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
        const model = yield* makeCohereEmbeddingModelFromUrl({ inputType: "search_document" });
        return yield* model.embedMany(["first", "second"]);
      }).pipe(Effect.provide(fetchLayer), Effect.provide(stubConfig(GATEWAY_CONFIG))),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://gateway.ai.cloudflare.com/v1/acct/website/cohere/v2/embed");
    expect(calls[0]?.cfAigAuthorizationHeader).toBe("Bearer test-token");
    expect(calls[0]?.body).toEqual({
      model: COHERE_EMBEDDING_MODEL,
      input_type: "search_document",
      texts: ["first", "second"],
      output_dimension: 1024,
      embedding_types: ["float"],
    });
    expect(response.embeddings.map((embedded) => [...embedded.vector])).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(response.usage.inputTokens).toBe(5);
  });

  it("fails with AiError on a non-2xx status", async () => {
    const { layer: fetchLayer } = stubFetch({
      status: 401,
      body: { message: "invalid token" },
    });

    const failure = await expectFailureInstanceOf(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModelFromUrl({ inputType: "search_document" });
        return yield* model.embedMany(["text"]);
      }).pipe(Effect.provide(fetchLayer), Effect.provide(stubConfig(GATEWAY_CONFIG))),
      AiError.AiError,
    );

    expect(failure.reason._tag).toBe("AuthenticationError");
  });

  it("fails with AiError when the response body cannot be parsed as JSON", async () => {
    const { layer: fetchLayer } = stubFetchMalformedBody();

    const failure = await expectFailureInstanceOf(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModelFromUrl({ inputType: "search_document" });
        return yield* model.embedMany(["text"]);
      }).pipe(Effect.provide(fetchLayer), Effect.provide(stubConfig(GATEWAY_CONFIG))),
      AiError.AiError,
    );

    expect(String(failure.message)).toContain("response body");
  });

  it("fails with AiError (not a defect) when the transport call rejects", async () => {
    const { layer: fetchLayer } = stubFetchReject();

    const failure = await expectFailureInstanceOf(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModelFromUrl({ inputType: "search_document" });
        return yield* model.embedMany(["text"]);
      }).pipe(Effect.provide(fetchLayer), Effect.provide(stubConfig(GATEWAY_CONFIG))),
      AiError.AiError,
    );

    expect(String(failure.message)).toContain("gateway call failed");
  });

  it("fails layer construction with a typed ConfigError when CF_ACCOUNT_ID is missing", async () => {
    const { layer: fetchLayer } = stubFetch({ status: 200, body: {} });

    const exit = await runTestExit(
      Effect.gen(function* () {
        const model = yield* makeCohereEmbeddingModelFromUrl({ inputType: "search_document" });
        return yield* model.embedMany(["text"]);
      }).pipe(
        Effect.provide(fetchLayer),
        Effect.provide(stubConfig({ CF_AIG_TOKEN: "test-token" })),
      ),
    );

    expect(exit._tag).toBe("Failure");
  });
});
