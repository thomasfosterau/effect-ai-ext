---
"@thomasfosterau/effect-evals": patch
---

The bundled declarations now type the value side of the `EvalCase`, `Golden`, `Metadata` and `Score` namespaces: `EvalCase.EvalCase`, `Golden.Golden`, `Golden.ConversationalGolden`, `Metadata.Metadata` and `Score.Score` are declared as the schema constructors they already were at runtime, where the previous declarations exported only their types. The `effect-evals` bin's missing-build message now names `vp run -r build`.
