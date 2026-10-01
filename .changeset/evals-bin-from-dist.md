---
"@thomasfosterau/effect-evals": patch
---

Fix the `effect-evals` bin failing to start from `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). The CLI entry is now built to `dist/cli/main.js` and the bin launches that; Node's type stripping and the loader hook apply only to your own `*.eval.ts` files. The CLI still needs the optional peer `@effect/platform-node` installed at the same version as `effect`.
