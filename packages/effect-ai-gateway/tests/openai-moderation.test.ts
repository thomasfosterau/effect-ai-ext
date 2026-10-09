/**
 * Unit tests for the gateway-routed OpenAI `ModerationModel` provider
 * (`makeOpenAiModerationModel` in `src/OpenAiModeration.ts`).
 *
 * The `AI` binding's `gateway(id).run(data, options)` is stubbed to capture
 * the outgoing universal-endpoint request and return a canned
 * `omni-moderation` response, so the tests exercise request shape
 * (provider, endpoint, model, the optional `Authorization` header), the
 * lenient response decode, and the `AiError` failure paths without reaching
 * the network.
 *
 * @module tests/unit/openai-moderation
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { AiError } from "effect/ai";
import {
  OPENAI_MODERATION_MODEL,
  makeOpenAiModerationModel,
  type OpenAiModerationOptions,
} from "@thomasfosterau/effect-ai-gateway";
import { stubAiBinding } from "./helpers/ai";
import { expectFailureInstanceOf, runTest } from "./helpers/effect";

/** Builds a stub `Ai` binding whose `gateway(id).run(data)` is canned. */
const stubAi = (response: { status: number; body: unknown }) => {
  const calls: unknown[] = [];
  const ai = stubAiBinding(() => ({
    run: async (data) => {
      calls.push(data);
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    },
  }));
  return { ai, calls };
};

const binding = (ai: Ai) => ({ ai, gatewayId: "website" });

/** One `omni-moderation` result, in the provider's wire shape. */
const omniResult = (
  flagged: boolean,
  categories: Record<string, boolean | null>,
  scores: Record<string, number | null>,
) => ({ flagged, categories, category_scores: scores });

const omniBody = (results: ReadonlyArray<unknown>, extra: Record<string, unknown> = {}) => ({
  id: "modr-test",
  model: "omni-moderation-latest",
  results,
  ...extra,
});

/** Moderates `inputs`; with no `options`, through the constructor's own default. */
const moderate = (ai: Ai, inputs: ReadonlyArray<string>, options?: OpenAiModerationOptions) =>
  Effect.gen(function* () {
    const model = yield* options === undefined
      ? makeOpenAiModerationModel(binding(ai))
      : makeOpenAiModerationModel(binding(ai), options);
    return yield* model.moderate({ inputs });
  });

describe("makeOpenAiModerationModel", () => {
  it("posts the moderations request through the universal endpoint, BYOK by default", async () => {
    const { ai, calls } = stubAi({
      status: 200,
      body: omniBody([omniResult(false, { hate: false }, { hate: 0.01 })]),
    });

    const response = await runTest(moderate(ai, ["hello"]));

    expect(calls).toEqual([
      {
        provider: "openai",
        endpoint: "moderations",
        headers: { "content-type": "application/json" },
        query: { model: OPENAI_MODERATION_MODEL, input: ["hello"] },
      },
    ]);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.isFlagged).toBe(false);
    expect(response.results[0]?.categories).toEqual({ hate: 0.01 });
    expect(response.usage.inputTokens).toBeUndefined();
  });

  it("sends the caller's own key as a bearer token when given one", async () => {
    const { ai, calls } = stubAi({ status: 200, body: omniBody([omniResult(false, {}, {})]) });

    await runTest(moderate(ai, ["hello"], { apiKey: Redacted.make("sk-test") }));

    const sent = calls[0] as { readonly headers: Record<string, string> };
    expect(sent.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer sk-test",
    });
  });

  it("requests the model the caller names", async () => {
    const { ai, calls } = stubAi({ status: 200, body: omniBody([omniResult(false, {}, {})]) });

    await runTest(moderate(ai, ["hello"], { model: "omni-moderation-2024-09-26" }));

    const sent = calls[0] as { readonly query: { readonly model: string } };
    expect(sent.query.model).toBe("omni-moderation-2024-09-26");
  });

  it("maps one result per input, in order, with every category score", async () => {
    const { ai } = stubAi({
      status: 200,
      body: omniBody([
        omniResult(true, { hate: true, violence: false }, { hate: 0.94, violence: 0.02 }),
        omniResult(false, { hate: false, violence: false }, { hate: 0.01, violence: 0.03 }),
      ]),
    });

    const response = await runTest(moderate(ai, ["nasty", "nice"]));

    expect(response.results.map((result) => result.isFlagged)).toEqual([true, false]);
    expect(response.results[0]?.categories).toEqual({ hate: 0.94, violence: 0.02 });
    expect(response.results[1]?.categories).toEqual({ hate: 0.01, violence: 0.03 });
  });

  it("drops null (unassessed) category scores rather than grading them as zero", async () => {
    const { ai } = stubAi({
      status: 200,
      body: omniBody([
        omniResult(false, { hate: null, sexual: false }, { hate: null, sexual: 0.2 }),
      ]),
    });

    const response = await runTest(moderate(ai, ["..."]));

    expect(response.results[0]?.categories).toEqual({ sexual: 0.2 });
  });

  it("never fails an otherwise-valid response over a vendor field it has never heard of", async () => {
    const { ai } = stubAi({
      status: 200,
      body: omniBody(
        [
          {
            ...omniResult(false, { hate: false }, { hate: 0.01 }),
            category_applied_input_types: { hate: ["text"] },
            a_field_added_next_quarter: { nested: [1, 2, 3] },
          },
        ],
        { usage: { total_tokens: 12 }, another_new_top_level_field: "ignored" },
      ),
    });

    const response = await runTest(moderate(ai, ["hello"]));

    expect(response.results[0]?.categories).toEqual({ hate: 0.01 });
  });

  it("tolerates a result with no category maps at all", async () => {
    const { ai } = stubAi({ status: 200, body: omniBody([{ flagged: true }]) });

    const response = await runTest(moderate(ai, ["hello"]));

    expect(response.results[0]).toMatchObject({ isFlagged: true, categories: {} });
  });

  it("returns an empty response for no inputs without calling the gateway", async () => {
    const { ai, calls } = stubAi({ status: 200, body: omniBody([]) });

    const response = await runTest(moderate(ai, []));

    expect(response.results).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("fails with AiError on a non-2xx status, mapping the status to a reason", async () => {
    const { ai } = stubAi({ status: 429, body: { error: { message: "rate limited" } } });

    const failure = await expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

    expect(failure.module).toBe("OpenAiModeration");
    expect(failure.method).toBe("moderate");
    expect(failure.reason._tag).toBe("RateLimitError");
    expect(failure.isRetryable).toBe(true);
  });

  it("fails with AiError (AuthenticationError) on a 401", async () => {
    const { ai } = stubAi({ status: 401, body: { error: { message: "bad key" } } });

    const failure = await expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

    expect(failure.reason._tag).toBe("AuthenticationError");
  });

  it("fails with AiError (InvalidOutputError) when the body does not decode", async () => {
    const { ai } = stubAi({ status: 200, body: { results: "nope" } });

    const failure = await expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

    expect(failure.reason._tag).toBe("InvalidOutputError");
  });

  it("fails with AiError (InvalidOutputError) when the result count does not match the inputs", async () => {
    const { ai } = stubAi({ status: 200, body: omniBody([]) });

    const failure = await expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

    expect(failure.reason._tag).toBe("InvalidOutputError");
    expect(String(failure.message)).toContain("expected 1");
  });

  it("fails with AiError (not a defect) when the gateway call itself rejects", async () => {
    const ai = stubAiBinding(() => ({
      run: async () => {
        throw new Error("socket hang up");
      },
    }));

    const failure = await expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

    expect(String(failure.message)).toContain("gateway call failed");
  });

  it("fails with AiError on a 200 whose body is not JSON at all", async () => {
    const ai = stubAiBinding(() => ({
      run: async () => new Response("<html>gateway error</html>", { status: 200 }),
    }));

    const failure = await expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

    expect(String(failure.message)).toContain("response body");
  });
});
