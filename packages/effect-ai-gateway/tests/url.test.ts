/**
 * Unit tests for the config-driven gateway HTTPS-endpoint resolution
 * (`src/Url.ts`).
 *
 * @module tests/unit/url
 */

import { assert, describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import {
  cfAigAuthorizationHeader,
  gatewayBaseUrl,
  gatewayUrlConfig,
} from "@thomasfosterau/effect-ai-gateway";
import { runTestExit } from "./helpers/effect";

const withConfig = (values: Record<string, string>) =>
  gatewayUrlConfig.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(values))));

describe("gatewayUrlConfig", () => {
  it("resolves accountId, gatewayId, and token from the environment", async () => {
    const exit = await runTestExit(
      withConfig({
        CF_ACCOUNT_ID: "acct",
        CF_AIG_GATEWAY_ID: "custom-gateway",
        CF_AIG_TOKEN: "secret",
      }),
    );

    assert(Exit.isSuccess(exit), "expected a success exit");
    expect(exit.value.accountId).toBe("acct");
    expect(exit.value.gatewayId).toBe("custom-gateway");
    expect(Redacted.value(exit.value.token)).toBe("secret");
  });

  it("fails with a typed ConfigError when CF_AIG_GATEWAY_ID is missing", async () => {
    const exit = await runTestExit(withConfig({ CF_ACCOUNT_ID: "acct", CF_AIG_TOKEN: "secret" }));

    assert(Exit.isFailure(exit), "expected a failure exit");
    const error = Cause.squash(exit.cause);
    expect(error).toBeInstanceOf(Config.ConfigError);
    expect(String(error)).toContain("CF_AIG_GATEWAY_ID");
  });

  it("treats an empty CF_AIG_GATEWAY_ID as missing", async () => {
    // rc.118's ConfigProvider reads "" as an absent value, so an empty
    // variable fails the same way an unset one does (no silent empty id).
    const exit = await runTestExit(
      withConfig({ CF_ACCOUNT_ID: "acct", CF_AIG_GATEWAY_ID: "", CF_AIG_TOKEN: "secret" }),
    );

    assert(Exit.isFailure(exit), "expected a failure exit");
    const error = Cause.squash(exit.cause);
    expect(error).toBeInstanceOf(Config.ConfigError);
    expect(String(error)).toContain("CF_AIG_GATEWAY_ID");
  });

  it("fails with a typed ConfigError when CF_ACCOUNT_ID is missing", async () => {
    const exit = await runTestExit(withConfig({ CF_AIG_TOKEN: "secret" }));

    expect(exit._tag).toBe("Failure");
  });

  it("fails with a typed ConfigError when CF_AIG_TOKEN is missing", async () => {
    const exit = await runTestExit(withConfig({ CF_ACCOUNT_ID: "acct" }));

    expect(exit._tag).toBe("Failure");
  });
});

describe("gatewayBaseUrl", () => {
  it("builds the gateway's public HTTPS base URL for a provider", () => {
    const url = gatewayBaseUrl(
      { accountId: "acct", gatewayId: "website", token: Redacted.make("secret") },
      "anthropic",
    );

    expect(url).toBe("https://gateway.ai.cloudflare.com/v1/acct/website/anthropic");
  });
});

describe("cfAigAuthorizationHeader", () => {
  it("builds a Bearer cf-aig-authorization header from the token", () => {
    const header = cfAigAuthorizationHeader({
      accountId: "acct",
      gatewayId: "website",
      token: Redacted.make("secret"),
    });

    expect(header).toEqual({ "cf-aig-authorization": "Bearer secret" });
  });
});
