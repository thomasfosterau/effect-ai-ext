/**
 * Unit tests for the shared AI Gateway binding plumbing (`src/Binding.ts`).
 *
 * @module tests/unit/binding
 */

import { assert, describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { gatewayRun, gatewayUrl } from "@thomasfosterau/effect-ai-gateway";
import { runTest } from "./helpers/effect";

/** Builds a stub `Ai` binding whose `gateway(id).getUrl(provider)` is canned. */
const stubAi = (behaviour: { url?: string; reject?: true }) => {
  const calls: Array<{ gatewayId: string; provider: string | undefined }> = [];
  const ai = {
    gateway: (gatewayId: string) => ({
      getUrl: async (provider?: string) => {
        calls.push({ gatewayId, provider });
        if (behaviour.reject) throw new Error("gateway unreachable");
        return behaviour.url;
      },
    }),
  } as unknown as Ai;
  return { ai, calls };
};

describe("gatewayUrl", () => {
  it("resolves the provider base URL through the binding", async () => {
    const { ai, calls } = stubAi({
      url: "https://gateway.ai.cloudflare.com/v1/acct/website/anthropic",
    });

    const url = await runTest(gatewayUrl({ ai, gatewayId: "website" }, "anthropic"));

    expect(url).toBe("https://gateway.ai.cloudflare.com/v1/acct/website/anthropic");
    expect(calls).toEqual([{ gatewayId: "website", provider: "anthropic" }]);
  });

  it("dies (does not fail typed) when the binding call rejects", async () => {
    const { ai } = stubAi({ reject: true });

    const exit = await Effect.runPromiseExit(gatewayUrl({ ai, gatewayId: "website" }, "cohere"));

    assert(Exit.isFailure(exit));
    expect(Cause.hasDies(exit.cause)).toBe(true);
  });
});

describe("gatewayRun", () => {
  it("runs the universal-endpoint request through the binding and returns the raw Response", async () => {
    const calls: unknown[] = [];
    const ai = {
      gateway: (_gatewayId: string) => ({
        run: async (data: unknown) => {
          calls.push(data);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      }),
    } as unknown as Ai;

    const response = await runTest(
      gatewayRun(
        { ai, gatewayId: "website" },
        { provider: "cohere", endpoint: "v2/embed", headers: {}, query: { texts: ["a"] } },
      ),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      { provider: "cohere", endpoint: "v2/embed", headers: {}, query: { texts: ["a"] } },
    ]);
  });

  it("fails with a typed UnknownError (not a defect) when the binding call rejects", async () => {
    // Unlike gatewayUrl, this is a real network call — a rejected promise
    // (a transient connectivity blip) must be a recoverable, typed failure
    // so callers like `generateEmbedding` can degrade to `null` uniformly,
    // not crash as a defect.
    const ai = {
      gateway: (_gatewayId: string) => ({
        run: async () => {
          throw new Error("gateway unreachable");
        },
      }),
    } as unknown as Ai;

    const exit = await Effect.runPromiseExit(
      gatewayRun(
        { ai, gatewayId: "website" },
        { provider: "cohere", endpoint: "v2/embed", headers: {}, query: {} },
      ),
    );

    assert(Exit.isFailure(exit));
    expect(Cause.hasDies(exit.cause)).toBe(false);
    expect(Cause.hasFails(exit.cause)).toBe(true);
  });

  it("aborts the in-flight subrequest when interrupted (#706/#730)", async () => {
    // Models a hung gateway call: `run` never resolves on its own, only
    // when its `AbortSignal` fires. `gatewayRun` declares `signal` on the
    // `Effect.tryPromise` evaluator, so a wrapping `Effect.timeout` cancels
    // the in-flight subrequest instead of merely abandoning it — the
    // #706/#730 lesson applied to this package's universal-run seam.
    let receivedSignal: AbortSignal | undefined;
    let aborted = false;
    const ai = {
      gateway: (_gatewayId: string) => ({
        run: (_data: unknown, options?: { signal?: AbortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            receivedSignal = options?.signal;
            options?.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          }),
      }),
    } as unknown as Ai;

    const exit = await runTest(
      Effect.exit(
        gatewayRun(
          { ai, gatewayId: "website" },
          { provider: "cohere", endpoint: "v2/rerank", headers: {}, query: {} },
        ).pipe(Effect.timeout("5 millis")),
      ),
    );

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(aborted).toBe(true);
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
