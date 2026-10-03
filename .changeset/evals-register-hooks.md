---
"@thomasfosterau/effect-evals": minor
---

**Breaking:** `effect-evals` now requires Node `>=22.18` (declared in `engines.node`). The CLI's extensionless-import resolution hook (`src/cli/loader.mjs`) is installed with the synchronous, in-thread `module.registerHooks()` instead of `module.register()`, which Node 26 deprecates (DEP0205), so a direct `node --import …/loader.mjs` run no longer prints a `module.register()` deprecation warning (the `effect-evals` bin already hid it with `--no-warnings=ExperimentalWarning`). `module.registerHooks()` does not exist before Node 22.15.0 / 23.5.0, and the floor goes to 22.18 because `effect-evals run` loads `*.eval.ts` files with Node's type stripping, which is on by default only from 22.18.0 (on 22.15–22.17 every eval file fails with `Unknown file extension ".ts"`); suite discovery also relies on `fs.promises.glob`, stable from 22.17.0. Consumers on an older Node must upgrade Node before upgrading this package. The library API is unchanged.
