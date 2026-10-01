/**
 * Unit tests for the binding-free, URL-based Anthropic `LanguageModel`
 * provider (`anthropicLanguageModelLayerFromUrl` in `src/Anthropic.ts`).
 *
 * Config (`CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`, `CF_AIG_TOKEN`) is supplied
 * through a `ConfigProvider.fromUnknown` layer instead of real environment
 * variables, and the network is stubbed at `FetchHttpClient.Fetch` — the
 * same technique `anthropic.test.ts` uses for the binding-based layer — so
 * these tests exercise the resolved gateway URL, the `cf-aig-authorization`
 * header, and the BYOK no-`x-api-key` contract without reaching the
 * network or requiring a Worker `AI` binding in scope.
 *
 * @module tests/unit/anthropic-url
 */

import { describe, expect, it } from "vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { LanguageModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { anthropicLanguageModelLayerFromUrl } from "@thomasfosterau/effect-ai-gateway";
import { runTest, runTestExit } from "./helpers/effect";

interface CapturedRequest {
  readonly url: string;
  readonly apiKeyHeader: string | null;
  readonly cfAigAuthorizationHeader: string | null;
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

/** Builds a Layer providing `Config` from an in-memory map, not `process.env`. */
const stubConfig = (values: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(values));

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

describe("anthropicLanguageModelLayerFromUrl", () => {
  it("routes generateText through the config-resolved gateway URL with the cf-aig-authorization header and no x-api-key", async () => {
    const { calls, layer: fetchLayer } = stubFetch({
      status: 200,
      body: anthropicMessageResponse("hello from the URL gateway"),
    });

    const response = await runTest(
      LanguageModel.generateText({ prompt: "say hello" }).pipe(
        Effect.provide(
          anthropicLanguageModelLayerFromUrl({ model: "claude-sonnet-4-6" }).pipe(
            Layer.provide(fetchLayer),
            Layer.provide(
              stubConfig({
                CF_ACCOUNT_ID: "acct",
                CF_AIG_GATEWAY_ID: "website",
                CF_AIG_TOKEN: "test-token",
              }),
            ),
          ),
        ),
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct/website/anthropic/v1/messages?beta=true",
    );
    expect(calls[0]?.apiKeyHeader).toBeNull();
    expect(calls[0]?.cfAigAuthorizationHeader).toBe("Bearer test-token");
    expect((calls[0]?.body as { model?: string } | undefined)?.model).toBe("claude-sonnet-4-6");
    expect(response.text).toBe("hello from the URL gateway");
  });

  it("defaults CF_AIG_GATEWAY_ID to the website gateway when unset", async () => {
    const { calls, layer: fetchLayer } = stubFetch({
      status: 200,
      body: anthropicMessageResponse("hello"),
    });

    await runTest(
      LanguageModel.generateText({ prompt: "say hello" }).pipe(
        Effect.provide(
          anthropicLanguageModelLayerFromUrl({ model: "claude-sonnet-4-6" }).pipe(
            Layer.provide(fetchLayer),
            Layer.provide(stubConfig({ CF_ACCOUNT_ID: "acct", CF_AIG_TOKEN: "test-token" })),
          ),
        ),
      ),
    );

    expect(calls[0]?.url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct/website/anthropic/v1/messages?beta=true",
    );
  });

  it("fails layer construction with a typed ConfigError when CF_ACCOUNT_ID is missing", async () => {
    const { layer: fetchLayer } = stubFetch({
      status: 200,
      body: anthropicMessageResponse("unreachable"),
    });

    const exit = await runTestExit(
      LanguageModel.generateText({ prompt: "say hello" }).pipe(
        Effect.provide(
          anthropicLanguageModelLayerFromUrl({ model: "claude-sonnet-4-6" }).pipe(
            Layer.provide(fetchLayer),
            Layer.provide(stubConfig({ CF_AIG_TOKEN: "test-token" })),
          ),
        ),
      ),
    );

    expect(exit._tag).toBe("Failure");
  });
});
