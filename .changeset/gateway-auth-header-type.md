---
"@thomasfosterau/effect-ai-gateway": patch
---

`cfAigAuthorizationHeader` now declares its return type as the exact header it builds, the new exported `CfAigAuthorizationHeader` interface (`{ readonly "cf-aig-authorization": string }`), instead of `Record<string, string>` (#98). The value is unchanged, and the new type is still assignable wherever a `Record<string, string>` is expected.
