---
"@thomasfosterau/effect-evals": patch
---

Replace native loops, `JSON`, `Map` / `Set` and non-null assertions with Effect modules (Effect lint plugin 0.6.0). A malformed `gEval` rubric or criteria definition now throws the exported `InvalidGEvalDefinitionError` (same messages) instead of a plain `Error`. Edge cases: an unserialisable task output now skips the cache write with a warning instead of writing `undefined`; the JSON reporter and the CLI's `--out` writer log a warning instead of crashing on an unserialisable result; `renderValue` and the CLI's error description render a value JSON cannot represent through `String` instead of returning `undefined`; a golden key named `__proto__` now counts toward the cache key.
