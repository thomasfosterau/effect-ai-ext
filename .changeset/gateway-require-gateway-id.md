---
"@thomasfosterau/effect-ai-gateway": minor
---

**Breaking:** `gatewayUrlConfig` (and every `make…FromUrl` / `…LayerFromUrl` that reads it) no longer defaults `CF_AIG_GATEWAY_ID` to `"website"`. The variable is now required: a missing or empty value fails layer construction with a typed `Config.ConfigError`, like `CF_ACCOUNT_ID` and `CF_AIG_TOKEN`. Consumers that relied on the default must now set `CF_AIG_GATEWAY_ID` explicitly before upgrading.
