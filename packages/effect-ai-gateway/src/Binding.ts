/**
 * Shared Cloudflare AI Gateway binding plumbing.
 *
 * The Worker's `AI` binding (`env.AI`, declared under `[ai]` in its
 * Wrangler config) is, at runtime, a plain Workers AI binding — the gateway association is not a distinct binding
 * type, only a runtime call: `ai.gateway(gatewayId)` returns the AI Gateway
 * runtime object. Every provider module in this package starts from that
 * same `{ ai, gatewayId }` pair rather than re-deriving it, so adding a
 * provider means adding a module beside this one, not new binding plumbing.
 *
 * The binding is typed by this module's own structural slice of it
 * ({@link WorkersAiBinding}), not by `@cloudflare/workers-types`' ambient
 * `Ai`, so the published declarations name nothing from that package and a
 * consumer that never installs it still type-checks them with
 * `skipLibCheck: false` (#113). A Worker's `env.AI`, typed `Ai` by
 * `@cloudflare/workers-types`, is assignable to {@link WorkersAiBinding}
 * (`tests/workers-types-binding.test.ts` proves it).
 *
 * @module Binding
 *
 * @copyright Thomas Foster
 */

import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

/**
 * An AI Gateway provider slug: the route segment after the gateway id
 * (`…/<account>/<gateway>/<provider>`). The known slugs (those
 * `@cloudflare/workers-types` lists as `AIGatewayProviders`) autocomplete;
 * any other string is accepted, as the gateway adds providers over time.
 */
export type GatewayProvider =
  | "workers-ai"
  | "anthropic"
  | "aws-bedrock"
  | "azure-openai"
  | "google-vertex-ai"
  | "huggingface"
  | "openai"
  | "perplexity-ai"
  | "replicate"
  | "groq"
  | "cohere"
  | "google-ai-studio"
  | "mistral"
  | "grok"
  | "openrouter"
  | "deepseek"
  | "cerebras"
  | "cartesia"
  | "elevenlabs"
  | "adobe-firefly"
  | (string & Record<never, never>);

/**
 * One request to the gateway's universal endpoint, as {@link gatewayRun}
 * sends it: the subset of `@cloudflare/workers-types`'
 * `AIGatewayUniversalRequest` this package uses, which a binding's `run()`
 * accepts.
 */
export interface GatewayUniversalRequest {
  /** The provider to route to. */
  readonly provider: GatewayProvider;
  /** The provider endpoint path, relative to the provider's base URL. */
  readonly endpoint: string;
  /** The headers sent to the provider. */
  readonly headers: Readonly<Record<string, string>>;
  /** The JSON request body sent to the provider. */
  readonly query: unknown;
}

/**
 * The options {@link gatewayRun} passes to the binding's `run()`: only the
 * abort `signal`. `gateway` and `extraHeaders` are declared `never` because
 * this package never sends them; naming them keeps an `Ai` from a
 * `@cloudflare/workers-types` release whose `run()` options predate `signal`
 * (`{ gateway?, extraHeaders? }`) assignable to {@link WorkersAiBinding}.
 */
export interface GatewayRunOptions {
  /** Cancels the in-flight gateway subrequest when the calling fiber is interrupted. */
  readonly signal: AbortSignal;
  /** Never sent. */
  readonly gateway?: never;
  /** Never sent. */
  readonly extraHeaders?: never;
}

/**
 * The slice of the AI Gateway runtime object (`ai.gateway(id)`) this package
 * calls: `getUrl` and `run`, with the arguments it passes.
 */
export interface WorkersAiGateway {
  /** Resolves the provider's base URL under this gateway. */
  readonly getUrl: (provider: GatewayProvider) => Promise<string>;
  /**
   * Runs one request through the universal endpoint. `signal` cancels the
   * in-flight subrequest.
   */
  readonly run: (data: GatewayUniversalRequest, options: GatewayRunOptions) => Promise<Response>;
}

/**
 * The slice of the Worker's Workers AI binding (`env.AI`) this package
 * calls: `gateway(id)`. A binding typed `Ai` by `@cloudflare/workers-types`
 * is assignable to it, so a Worker passes `env.AI` unchanged.
 */
export interface WorkersAiBinding {
  /** Returns the AI Gateway runtime object for one gateway id. */
  readonly gateway: (gatewayId: string) => WorkersAiGateway;
}

/** The Worker's `AI` binding, plus the gateway id it should route through. */
export interface GatewayBinding {
  /** The Worker's raw Workers AI binding (`env.AI`). */
  readonly ai: WorkersAiBinding;
  /**
   * The AI Gateway id to route through: the gateway's name in the
   * Cloudflare dashboard. Declare it once in the application and import it,
   * rather than re-declaring the literal at each call site.
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
  provider: GatewayProvider,
): Effect.Effect<string> =>
  Effect.orDie(Effect.tryPromise(() => binding.ai.gateway(binding.gatewayId).getUrl(provider)));

/**
 * Runs one request through the gateway's universal endpoint
 * (`ai.gateway(id).run(data, { signal })`), for providers with no
 * `@effect/ai-*` package to repoint (Anthropic's `apiUrl` swap in
 * `Anthropic.ts` doesn't need this).
 *
 * The `signal` parameter is **declared** on the `Effect.tryPromise`
 * evaluator, not omitted — the website#706 / website#730 lesson:
 * `Effect.tryPromise` threads Effect's managed `AbortSignal` as part of its
 * contract when the evaluator declares the parameter, so a wrapping
 * `Effect.timeout` (or any interruption) cancels the in-flight gateway
 * subrequest instead of merely abandoning it.
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
  data: GatewayUniversalRequest,
): Effect.Effect<Response, Cause.UnknownError> =>
  Effect.tryPromise((signal) => binding.ai.gateway(binding.gatewayId).run(data, { signal }));
