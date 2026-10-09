---
"@thomasfosterau/effect-ai-cohere": patch
"@thomasfosterau/effect-ai-elevenlabs": patch
"@thomasfosterau/effect-ai-gateway": patch
"@thomasfosterau/effect-ai-mistral": patch
"@thomasfosterau/effect-ai-voyage": patch
---

Model-id and provider-id parameters are spelled `Model | (string & Record<never, never>)` instead of `Model | (string & {})` (#98). The accepted values are unchanged: any string is still accepted, and the known ids still autocomplete. In `effect-ai-cohere`, the embedding and reranker `model` options, which have no list of known ids, are now plain `string`.
