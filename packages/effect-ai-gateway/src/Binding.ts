/**
 * @copyright Thomas Foster
 *
 * Shared Cloudflare AI Gateway binding plumbing.
 *
 * The Worker's `AI` binding (`env.AI`, from `Cloudflare.AI.Gateway("AI", {
 * id: "website" })` in `@thomasfosterau/bindings`) is, at runtime, a plain
 * Workers AI binding (`Ai`) — the gateway association is not a distinct
 * binding type, only a runtime call: `ai.gateway(gatewayId)` returns the
 * `AiGateway` runtime object (`@cloudflare/workers-types`). Every provider
 * module in this package starts from that same `{ ai, gatewayId }` pair
 * rather than re-deriving it, so adding a provider means adding a module
 * beside this one, not new binding plumbing.
 *
 * @module Binding
 */

import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

/** The Worker's `AI` binding, plus the gateway id it should route through. */
export interface GatewayBinding {
  /** The Worker's raw Workers AI binding (`env.AI`). */
  readonly ai: Ai;
  /**
   * The AI Gateway id to route through — the same id passed to
   * `Cloudflare.AI.Gateway("AI", { id })` in `@thomasfosterau/bindings`
   * (exported there as `AI_GATEWAY_ID`; import it rather than
   * re-declaring the literal at each call site).
   */
  readonly gatewayId: string;
}

/**
 * Resolves the base URL for a provider routed through this gateway
 * (`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/<provider>`)
 * via the binding's `getUrl` — never hand-built, so the account id is
 * never duplicated in this package.
 *
 * A failure here (a malformed gateway id, an unbound `AI`) is a
 * deploy-time defect, not a "provider not configured yet" state — BYOK
 * provider keys live entirely server-side in the gateway, so this package
 * never holds a credential to check (mirrors `Effect.orDie(bucket.get(id))`
 * in apps/web's `src/lib/server/effect/r2.ts` for the same
 * "binding access failing is a server defect" posture). A missing/invalid
 * key surfaces as an ordinary `AiError` from the provider call itself, at
 * request time, exactly like the direct-API wiring it replaces.
 */
export const gatewayUrl = (
  binding: GatewayBinding,
  provider: AIGatewayProviders | (string & {}),
): Effect.Effect<string> =>
  Effect.orDie(Effect.tryPromise(() => binding.ai.gateway(binding.gatewayId).getUrl(provider)));

/**
 * Runs one request through the gateway's universal endpoint
 * (`ai.gateway(id).run(data, { signal })`), for providers with no
 * `@effect/ai-*` package to repoint (Anthropic's `apiUrl` swap in
 * `Anthropic.ts` doesn't need this).
 *
 * The `signal` parameter is **declared** on the `Effect.tryPromise`
 * evaluator, not omitted — the #706/#730 lesson: `Effect.tryPromise`
 * threads Effect's managed `AbortSignal` as part of its contract when the
 * evaluator declares the parameter, so a wrapping `Effect.timeout` (or
 * any interruption) cancels the in-flight gateway subrequest instead of
 * merely abandoning it.
 *
 * Unlike {@link gatewayUrl} (pure local URL templating, essentially
 * infallible), this is a real network call to an external provider, so a
 * rejected promise (a transient connectivity blip, a malformed request the
 * gateway rejects before proxying) is a **typed, recoverable failure**
 * here — the same posture every other AI provider call in this codebase
 * takes (`packages/ai`'s Voyage/Workers-AI clients, `@effect/ai-anthropic`)
 * — not a defect. Provider modules (`Cohere.ts`) map it into their own
 * `AiError` alongside their non-2xx status handling, so a caller like
 * `generateEmbedding` can degrade to `null` on ANY failure uniformly. The
 * returned `Response`'s status is otherwise the caller's to interpret — a
 * non-2xx gateway/provider response is a normal success here, not a
 * failure, so provider modules decide how to map it.
 */
export const gatewayRun = (
  binding: GatewayBinding,
  data: AIGatewayUniversalRequest,
): Effect.Effect<Response, Cause.UnknownError> =>
  Effect.tryPromise((signal) => binding.ai.gateway(binding.gatewayId).run(data, { signal }));
