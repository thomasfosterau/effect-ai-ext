---
"@thomasfosterau/effect-ai-cohere": patch
---

`toolChoice: "none"` now sends the tool definitions with `tool_choice: "NONE"`, so the model sees the tools but cannot call them. Previously it dropped `tools` and `tool_choice` from the `/v2/chat` request body entirely (#121). A request without a toolkit still sends neither field. `NONE` is only accepted by Command R7B and newer models.
