---
"@thomasfosterau/effect-evals": patch
---

`Threshold.passes` and `Threshold.describe` now throw (so the run dies) on a policy with an unknown `_tag`, possible only from an untyped eval file, where `passes` used to count it silently as a fail and `describe` returned `undefined`. This shipped in #119 without a changeset; typed callers are unaffected.
