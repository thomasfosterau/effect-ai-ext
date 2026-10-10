---
"@thomasfosterau/effect-ai-mistral": patch
---

`toolChoice: "none"` now sends the tool definitions with `tool_choice: "none"`, so the model sees the tools but cannot call them. Previously it dropped `tools` and `tool_choice` from the chat-completions request body entirely (#121). A request without a toolkit still sends neither field.
