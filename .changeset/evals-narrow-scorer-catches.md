---
"@thomasfosterau/effect-evals": minor
---

`jsonValidity`, `schemaMatch` and `schemaMatchValue` now recover only from the failure that is a verdict on the output, and let anything else fail the run (#98):

- `jsonValidity` scores `0` for text `JSON.parse` rejects (its `SyntaxError`), as before. Anything else thrown while parsing (possible only when `output` is not the string `JsonCase` promises) is now a defect that fails the run instead of a silent `0`.
- `schemaMatch` / `schemaMatchValue` score `0` for a `SchemaError`, as before, and catch nothing else, so a defect in a schema's own transformation fails the run.
- The runner still treats an unparseable cache entry as a miss; anything else thrown while reading one is a defect.
