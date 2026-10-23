/**
 * Unit tests for the binding-free, URL-based OpenAI `ModerationModel`
 * provider (`makeOpenAiModerationModelFromUrl` in `src/OpenAiModeration.ts`).
 *
 * Config is supplied through `ConfigProvider.fromUnknown` instead of real
 * environment variables, and the network is stubbed at
 * `FetchHttpClient.Fetch` — so these tests exercise the resolved gateway
 * URL, the `cf-aig-authorization` header, the optional bearer token, the
 * request shape, and the lenient response decode without reaching the
 * network or requiring a Worker `AI` binding.
 *
 * @module tests/unit/openai-moderation-url
 */

import { describe, expect, it } from "vite-plus/test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { AiError } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import type { ModerationModel } from "@thomasfosterau/effect-ai-ext";
import {
  OPENAI_MODERATION_MODEL,
  makeOpenAiModerationModelFromUrl,
  type OpenAiModerationCall,
  type OpenAiModerationOptions,
} from "@thomasfosterau/effect-ai-gateway";
import { expectFailureInstanceOf, runTest, runTestExit } from "./helpers/effect";

interface CapturedRequest {
  readonly url: string;
  readonly cfAigAuthorizationHeader: string | null;
  readonly authorizationHeader: string | null;
  readonly body: unknown;
}

const stubFetch = (respond: () => Response) => {
  const calls: CapturedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      cfAigAuthorizationHeader: request.headers.get("cf-aig-authorization"),
      authorizationHeader: request.headers.get("authorization"),
      body: await request.json(),
    });
    return respond();
  };
  const layer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
  return { calls, layer };
};

const jsonResponse = (status: number, body: unknown) => () => Response.json(body, { status });

const stubConfig = (values: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(values));

const GATEWAY_CONFIG = {
  CF_ACCOUNT_ID: "acct",
  CF_AIG_GATEWAY_ID: "website",
  CF_AIG_TOKEN: "test-token",
};

const omniBody = (results: ReadonlyArray<unknown>, extra: Record<string, unknown> = {}) => ({
  id: "modr-test",
  model: "omni-moderation-latest",
  results,
  ...extra,
});

const okResult = { flagged: false, categories: { hate: false }, category_scores: { hate: 0.01 } };

const moderate = (
  inputs: ReadonlyArray<ModerationModel.ModerationInput>,
  options: OpenAiModerationOptions = {},
) =>
  Effect.gen(function* () {
    const model = yield* makeOpenAiModerationModelFromUrl(options);
    return yield* model.moderate({ inputs });
  });

describe("makeOpenAiModerationModelFromUrl", () => {
  it("posts the moderations request to the config-resolved gateway URL with the cf-aig-authorization header", async () => {
    const { calls, layer: fetchLayer } = stubFetch(jsonResponse(200, omniBody([okResult])));

    const response = await runTest(
      moderate(["hello"]).pipe(
        Effect.provide(fetchLayer),
        Effect.provide(stubConfig(GATEWAY_CONFIG)),
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct/website/openai/moderations",
    );
    expect(calls[0]?.cfAigAuthorizationHeader).toBe("Bearer test-token");
    // BYOK by default: no provider key leaves this process.
    expect(calls[0]?.authorizationHeader).toBeNull();
    expect(calls[0]?.body).toEqual({ model: OPENAI_MODERATION_MODEL, input: ["hello"] });
    expect(response.results[0]).toMatchObject({ isFlagged: false, categories: { hate: 0.01 } });
    expect(response.usage.inputTokens).toBeUndefined();
  });

  it("sends the caller's own key as a bearer token alongside the gateway token", async () => {
    const { calls, layer: fetchLayer } = stubFetch(jsonResponse(200, omniBody([okResult])));

    await runTest(
      moderate(["hello"], { apiKey: Redacted.make("sk-test") }).pipe(
        Effect.provide(fetchLayer),
        Effect.provide(stubConfig(GATEWAY_CONFIG)),
      ),
    );

    expect(calls[0]?.cfAigAuthorizationHeader).toBe("Bearer test-token");
    expect(calls[0]?.authorizationHeader).toBe("Bearer sk-test");
  });

  it("never fails an otherwise-valid response over a vendor field it has never heard of", async () => {
    const { layer: fetchLayer } = stubFetch(
      jsonResponse(
        200,
        omniBody(
          [
            {
              ...okResult,
              category_applied_input_types: { hate: ["text"] },
              a_field_added_next_quarter: true,
            },
          ],
          { usage: { total_tokens: 12 } },
        ),
      ),
    );

    const response = await runTest(
      moderate(["hello"]).pipe(
        Effect.provide(fetchLayer),
        Effect.provide(stubConfig(GATEWAY_CONFIG)),
      ),
    );

    expect(response.results[0]?.categories).toEqual({ hate: 0.01 });
  });

  it("drops null (unassessed) category scores", async () => {
    const { layer: fetchLayer } = stubFetch(
      jsonResponse(
        200,
        omniBody([
          {
            flagged: false,
            categories: { hate: null, sexual: false },
            category_scores: { hate: null, sexual: 0.2 },
          },
        ]),
      ),
    );

    const response = await runTest(
      moderate(["..."]).pipe(
        Effect.provide(fetchLayer),
        Effect.provide(stubConfig(GATEWAY_CONFIG)),
      ),
    );

    expect(response.results[0]?.categories).toEqual({ sexual: 0.2 });
  });

  it("fails with AiError on a non-2xx status", async () => {
    const { layer: fetchLayer } = stubFetch(jsonResponse(429, { error: { message: "slow" } }));

    const failure = await expectFailureInstanceOf(
      moderate(["..."]).pipe(
        Effect.provide(fetchLayer),
        Effect.provide(stubConfig(GATEWAY_CONFIG)),
      ),
      AiError.AiError,
    );

    expect(failure.module).toBe("OpenAiModeration");
    expect(failure.reason._tag).toBe("RateLimitError");
  });

  it("fails with AiError when the response body cannot be parsed as JSON", async () => {
    const { layer: fetchLayer } = stubFetch(
      () =>
        new Response("not valid json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const failure = await expectFailureInstanceOf(
      moderate(["..."]).pipe(
        Effect.provide(fetchLayer),
        Effect.provide(stubConfig(GATEWAY_CONFIG)),
      ),
      AiError.AiError,
    );

    expect(String(failure.message)).toContain("response body");
  });

  it("fails with AiError (not a defect) when the transport call rejects", async () => {
    const { layer: fetchLayer } = stubFetch(() => {
      throw new TypeError("network unreachable");
    });

    const failure = await expectFailureInstanceOf(
      moderate(["..."]).pipe(
        Effect.provide(fetchLayer),
        Effect.provide(stubConfig(GATEWAY_CONFIG)),
      ),
      AiError.AiError,
    );

    expect(String(failure.message)).toContain("gateway call failed");
  });

  it("fails construction with a typed ConfigError when CF_ACCOUNT_ID is missing", async () => {
    const { calls, layer: fetchLayer } = stubFetch(jsonResponse(200, omniBody([okResult])));

    const exit = await runTestExit(
      makeOpenAiModerationModelFromUrl().pipe(
        Effect.provide(fetchLayer),
        Effect.provide(stubConfig({ CF_AIG_TOKEN: "test-token" })),
      ),
    );

    expect(exit._tag).toBe("Failure");
    expect(calls).toHaveLength(0);
  });

  it("posts an image input as an image_url part and carries flags and the served model", async () => {
    const { calls, layer: fetchLayer } = stubFetch(
      jsonResponse(
        200,
        omniBody(
          [{ flagged: true, categories: { violence: true }, category_scores: { violence: 0.8 } }],
          {
            model: "omni-moderation-2024-09-26",
          },
        ),
      ),
    );

    const response = await runTest(
      moderate([
        [{ type: "file", mediaType: "image/jpeg", data: "data:image/jpeg;base64,/9j/" }],
      ]).pipe(Effect.provide(fetchLayer), Effect.provide(stubConfig(GATEWAY_CONFIG))),
    );

    expect(calls[0]?.body).toEqual({
      model: OPENAI_MODERATION_MODEL,
      input: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } }],
    });
    expect(response.results[0]).toMatchObject({
      isFlagged: true,
      categories: { violence: 0.8 },
      flags: { violence: true },
    });
    expect(response.modelId).toBe("omni-moderation-2024-09-26");
  });

  it("reports each HTTP call's status and timing to onCall", async () => {
    const seen: Array<OpenAiModerationCall> = [];
    const { layer: fetchLayer } = stubFetch(jsonResponse(503, { error: { message: "down" } }));

    const failure = await expectFailureInstanceOf(
      moderate(["..."], { onCall: (call) => Effect.sync(() => seen.push(call)) }).pipe(
        Effect.provide(fetchLayer),
        Effect.provide(stubConfig(GATEWAY_CONFIG)),
      ),
      AiError.AiError,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.status).toBe(503);
    expect(seen[0]?.durationMillis).toBeGreaterThanOrEqual(0);
    expect(seen[0]?.error).toBe(failure);
  });
});
