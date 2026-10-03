---
"@thomasfosterau/effect-evals": minor
---

**Breaking:** `effect-evals` now requires Node `>=22.15` (declared in `engines.node`). The CLI's extensionless-import resolution hook (`src/cli/loader.mjs`) is installed with the synchronous, in-thread `module.registerHooks()` instead of `module.register()`, which Node 26 deprecates (DEP0205), so CLI runs no longer print a `module.register()` deprecation warning. `module.registerHooks()` does not exist before Node 22.15.0 / 23.5.0: consumers on an older Node must upgrade Node before upgrading this package. The library API is unchanged.
