---
"@thomasfosterau/effect-ai-ext": patch
"@thomasfosterau/effect-ai-gateway": patch
"@thomasfosterau/effect-ai-mistral": patch
"@thomasfosterau/effect-ai-cohere": patch
"@thomasfosterau/effect-ai-voyage": patch
"@thomasfosterau/effect-ai-elevenlabs": patch
"@thomasfosterau/effect-evals": patch
---

Build with `vp pack` (tsdown) instead of tsup. Every entry point and subpath keeps the same file name and the same runtime and type exports; only the internal chunk files under `dist/` are named differently, and the bundled declarations name types by their own names instead of minified aliases. The published `src/` is reformatted by Oxfmt with no code change.
