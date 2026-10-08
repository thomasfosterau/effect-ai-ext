---
"@thomasfosterau/effect-evals": minor
---

`jsonValidity` now recovers only from the failure that is a verdict on the output, and lets anything else fail the run (#98):

- `jsonValidity` scores `0` for text `JSON.parse` rejects (its `SyntaxError`), as before. Anything else thrown while parsing (possible only when `output` is not the string `JsonCase` promises) is now a defect that fails the run instead of a silent `0`.
- `schemaMatch` / `schemaMatchValue`: no behaviour change. Their catch is now typed to `SchemaError`, which was already the decode's only failure; a defect in a schema's own transformation already failed the run, and still does.
- The runner still treats an unparseable cache entry as a miss; anything else thrown while reading one is a defect.
