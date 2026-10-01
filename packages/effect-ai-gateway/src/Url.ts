/**
 * Config-driven resolution of the Cloudflare AI Gateway's public HTTPS
 * endpoint (`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/...`)
 * — the binding-free sibling of `Binding.ts`'s `gatewayUrl`/`gatewayRun`,
 * for callers with no Worker `AI` binding to ask: a local CLI, a plain
 * Node process, or a CI job. The BYOK posture still applies: provider keys
 * live in the gateway, never here.
 *
 * The gateway's authenticated-gateway feature must be enabled for the
 * `cf-aig-authorization` token this module reads to actually be enforced;
 * without it the gateway accepts unauthenticated requests too.
 *
 * @module Url
 *
 * @copyright Thomas Foster
 */

import * as Config from "effect/Config";
import * as Redacted from "effect/Redacted";

/** Config resolved for building a gateway request against its HTTPS endpoint. */
export interface GatewayUrlConfig {
  /** The Cloudflare account id the gateway belongs to. */
  readonly accountId: string;
  /**
   * The AI Gateway id to route through — the same id passed to
   * `Cloudflare.AI.Gateway("AI", { id })` in `@thomasfosterau/bindings`
   * (`AI_GATEWAY_ID`, currently `"website"`). Not imported from that
   * package here — this module stays binding-agnostic — so the default
   * below is a literal kept in sync by convention, overridable via
   * `CF_AIG_GATEWAY_ID` for any other gateway.
   */
  readonly gatewayId: string;
  /**
   * The gateway's authenticated-gateway token, sent as the
   * `cf-aig-authorization` header. `Redacted` so it never prints in a log
   * or error message.
   */
  readonly token: Redacted.Redacted<string>;
}

/**
 * Loads {@link GatewayUrlConfig} from the environment: `CF_ACCOUNT_ID`,
 * `CF_AIG_GATEWAY_ID` (defaults to `"website"`), `CF_AIG_TOKEN`. A missing
 * `CF_ACCOUNT_ID` or `CF_AIG_TOKEN` fails layer construction with a typed
 * `Config.ConfigError` — never a plain-string fallback standing in for a
 * real credential.
 */
export const gatewayUrlConfig: Config.Config<GatewayUrlConfig> = Config.all({
  accountId: Config.String("CF_ACCOUNT_ID"),
  gatewayId: Config.String("CF_AIG_GATEWAY_ID").pipe(Config.withDefault("website")),
  token: Config.Redacted("CF_AIG_TOKEN"),
});

/**
 * Builds the gateway's public HTTPS base URL for one provider — the same
 * route shape `Binding.ts`'s `gatewayUrl` resolves from the Worker binding
 * (`ai.gateway(id).getUrl(provider)`), hand-built here since there is no
 * binding to ask.
 */
export const gatewayBaseUrl = (
  config: GatewayUrlConfig,
  provider: AIGatewayProviders | (string & {}),
): string =>
  `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}/${provider}`;

/**
 * The `cf-aig-authorization` header Cloudflare's authenticated-gateway
 * feature requires on every request once enabled.
 */
export const cfAigAuthorizationHeader = (config: GatewayUrlConfig): Record<string, string> => ({
  "cf-aig-authorization": `Bearer ${Redacted.value(config.token)}`,
});
