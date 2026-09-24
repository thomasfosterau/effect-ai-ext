---
"@thomasfosterau/effect-ai-ext": patch
"@thomasfosterau/effect-ai-gateway": patch
"@thomasfosterau/effect-ai-mistral": patch
"@thomasfosterau/effect-ai-cohere": patch
"@thomasfosterau/effect-ai-voyage": patch
"@thomasfosterau/effect-ai-elevenlabs": patch
"@thomasfosterau/effect-evals": patch
---

Fix the `homepage` link in every package manifest: it pointed at a `tree/main/…` path on GitHub, but the repository's default branch is `trunk`, so the link npm shows for each package 404'd. No code changes.
