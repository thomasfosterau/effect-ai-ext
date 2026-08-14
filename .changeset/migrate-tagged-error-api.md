---
"@thomasfosterau/effect-evals": patch
---

Migrate off the removed `Schema.TaggedErrorClass` API (renamed to `Schema.TaggedError` in effect 4.0.0-beta.104) and widen the `effect` peer dependency to `>=4.0.0-beta.104`. The exact `4.0.0-beta.99` pin was already unsatisfiable for consumers on beta.102+.
