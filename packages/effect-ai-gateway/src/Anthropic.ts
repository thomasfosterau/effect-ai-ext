/**
 * Anthropic `LanguageModel` provider routed through the Cloudflare AI
 * Gateway Worker binding (website#847), replacing the direct
 * `api.anthropic.com` call. The provider key is BYOK,
 * configured once on the `website` gateway (Cloudflare dashboard,
 * provider keys) — never an env var, so this module never takes or reads
 * an API key.
 *
 * Exposes the exact `@effect/ai-anthropic` layer surface consumers
 * already use — `AnthropicLanguageModel.layer({ model })` — unchanged.
 * Only the `AnthropicClient` beneath it changes: from a direct API key to
 * the gateway's resolved base URL with no key (the gateway injects the
 * stored BYOK credential upstream, and omits the `x-api-key` header
 * entirely per Cloudflare's BYOK contract). Callers swap this module's
 * `anthropicLanguageModelLayer` in for the old `AnthropicClient.layer` +
 * `AnthropicLanguageModel.layer` pair; nothing downstream of
 * `LanguageModel.LanguageModel` changes.
 *
 * @module Anthropic
 *
 * @copyright Thomas Foster
 */

import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import type * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { LanguageModel } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { gatewayUrl, type GatewayBinding } from "./Binding";
import * as Url from "./Url";

/**
 * The AI Gateway provider slug for Anthropic
 * (`AIGatewayProviders["anthropic"]` in `@cloudflare/workers-types`).
 */
const ANTHROPIC_PROVIDER = "anthropic";

/**
 * Builds a `LanguageModel` Layer that sends Anthropic Messages API
 * requests through the AI Gateway's Anthropic route
 * (`<gateway>/anthropic/v1/messages`), authenticated via the gateway's
 * BYOK provider key. Drop-in for `AnthropicLanguageModel.layer({ model
 * })` + `AnthropicClient.layer({ apiKey })`: same `LanguageModel`
 * tag, same `never` error/requirement shape.
 */
export const anthropicLanguageModelLayer = (
  binding: GatewayBinding,
  options: { readonly model: AnthropicLanguageModel.Model | (string & {}) },
): Layer.Layer<LanguageModel.LanguageModel> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const apiUrl = yield* gatewayUrl(binding, ANTHROPIC_PROVIDER);
      return AnthropicLanguageModel.layer({ model: options.model }).pipe(
        Layer.provide(AnthropicClient.layer({ apiUrl, apiKey: undefined })),
        Layer.provide(FetchHttpClient.layer),
      );
    }),
  );

/**
 * Builds a `LanguageModel` Layer that sends Anthropic Messages API requests
 * through the AI Gateway's **public HTTPS endpoint**
 * (`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic`),
 * authenticated via the gateway's `cf-aig-authorization` token — the
 * binding-free sibling of {@link anthropicLanguageModelLayer}, usable from
 * a plain Node process, a local CLI, or CI, where there is no Worker `AI`
 * binding to resolve the URL from. BYOK still applies: `apiKey: undefined`
 * on the `AnthropicClient` — the Anthropic provider key stays configured
 * server-side on the gateway, never here.
 *
 * Config (`CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`, `CF_AIG_TOKEN`) is loaded
 * via `Url.gatewayUrlConfig`; a missing required value fails layer
 * construction with a typed `Config.ConfigError`, not a silent fallback.
 * Rides `FetchHttpClient` (like {@link anthropicLanguageModelLayer}), whose
 * `fetch` calls are already interruption-safe (the website#706 /
 * website#730 lesson) — no manual `signal` plumbing needed here, unlike
 * `Binding.ts`'s raw `ai.gateway(id).run()` seam.
 */
export const anthropicLanguageModelLayerFromUrl = (options: {
  readonly model: AnthropicLanguageModel.Model | (string & {});
}): Layer.Layer<LanguageModel.LanguageModel, Config.ConfigError> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const gatewayConfig = yield* Url.gatewayUrlConfig;
      const apiUrl = Url.gatewayBaseUrl(gatewayConfig, ANTHROPIC_PROVIDER);
      const authHeader = Url.cfAigAuthorizationHeader(gatewayConfig);
      return AnthropicLanguageModel.layer({ model: options.model }).pipe(
        Layer.provide(
          AnthropicClient.layer({
            apiUrl,
            apiKey: undefined,
            transformClient: (client) =>
              HttpClient.mapRequest(client, (request) =>
                HttpClientRequest.setHeaders(request, authHeader),
              ),
          }),
        ),
        Layer.provide(FetchHttpClient.layer),
      );
    }),
  );
