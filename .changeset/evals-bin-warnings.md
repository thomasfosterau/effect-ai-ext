---
"@thomasfosterau/effect-evals": patch
---

The `effect-evals` bin starts Node with `--disable-warning=ExperimentalWarning` instead of `--no-warnings=ExperimentalWarning`. Node ignores the value of `--no-warnings`, so the old flag hid every process warning, `DeprecationWarning`s included (that is how DEP0205 stayed hidden for CLI users); warnings raised by the CLI, its dependencies or a consumer's `*.eval.ts` files now reach stderr. Only `ExperimentalWarning`s stay hidden: on Node 23.x and early 24.x `fs.promises.glob` and type stripping still print one on every run.
