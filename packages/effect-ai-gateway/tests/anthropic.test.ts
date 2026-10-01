/**
 * Unit tests for the gateway-routed Anthropic `LanguageModel` provider
 * (`src/Anthropic.ts`).
 *
 * The `AI` binding's `gateway(id).getUrl("anthropic")` is stubbed to
 * return a fixed base URL, and the network is stubbed at
 * `FetchHttpClient.Fetch` (the same technique `packages/ai`'s Voyage
 * tests use) — the stub captures the outgoing Request and returns a
 * canned Anthropic Messages API response, so the tests exercise request
 * routing (gateway URL + `/v1/messages`), the BYOK no-`x-api-key`
 * contract, and response decoding without reaching the network.
 *
 * @module tests/unit/anthropic
 */

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { LanguageModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { anthropicLanguageModelLayer } from "@thomasfosterau/effect-ai-gateway";
import { runTest } from "./helpers/effect";

const GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/acct/website/anthropic";

/** Builds a stub `Ai` binding whose `gateway(id).getUrl(provider)` is canned. */
const stubAi = (url: string): Ai =>
  ({
    gateway: (_gatewayId: string) => ({
      getUrl: async (_provider?: string) => url,
    }),
  }) as unknown as Ai;

interface CapturedRequest {
  readonly url: string;
  readonly apiKeyHeader: string | null;
  readonly versionHeader: string | null;
  readonly body: unknown;
}

/** Builds a Layer providing a `FetchHttpClient` whose fetch is a stub. */
const stubFetch = (response: { status: number; body: unknown }) => {
  const calls: CapturedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      apiKeyHeader: request.headers.get("x-api-key"),
      versionHeader: request.headers.get("anthropic-version"),
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

const anthropicMessageResponse = (text: string) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text }],
  model: "claude-sonnet-4-6",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    input_tokens: 10,
    output_tokens: 5,
    service_tier: null,
  },
});

describe("anthropicLanguageModelLayer", () => {
  it("routes generateText through the resolved gateway URL with no x-api-key", async () => {
    const { calls, layer: fetchLayer } = stubFetch({
      status: 200,
      body: anthropicMessageResponse("hello from the gateway"),
    });
    const ai = stubAi(GATEWAY_URL);

    const response = await runTest(
      LanguageModel.generateText({ prompt: "say hello" }).pipe(
        Effect.provide(
          anthropicLanguageModelLayer(
            { ai, gatewayId: "website" },
            { model: "claude-sonnet-4-6" },
          ).pipe(Layer.provide(fetchLayer)),
        ),
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${GATEWAY_URL}/v1/messages?beta=true`);
    expect(calls[0]?.apiKeyHeader).toBeNull();
    expect(calls[0]?.versionHeader).toBe("2023-06-01");
    expect((calls[0]?.body as { model?: string } | undefined)?.model).toBe("claude-sonnet-4-6");
    expect(response.text).toBe("hello from the gateway");
  });

  it("fails with AiError when the gateway responds with an error status", async () => {
    const { layer: fetchLayer } = stubFetch({
      status: 401,
      body: {
        type: "error",
        error: { type: "authentication_error", message: "no BYOK key configured" },
      },
    });
    const ai = stubAi(GATEWAY_URL);

    const exit = await Effect.runPromiseExit(
      LanguageModel.generateText({ prompt: "say hello" }).pipe(
        Effect.provide(
          anthropicLanguageModelLayer(
            { ai, gatewayId: "website" },
            { model: "claude-sonnet-4-6" },
          ).pipe(Layer.provide(fetchLayer)),
        ),
      ),
    );

    expect(exit._tag).toBe("Failure");
  });
});
