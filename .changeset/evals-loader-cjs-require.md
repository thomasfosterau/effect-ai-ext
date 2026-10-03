---
"@thomasfosterau/effect-evals": patch
---

The CLI's resolution hook (`src/cli/loader.mjs`) leaves CommonJS resolution (`require()`, `createRequire()`, `require.resolve()`) to Node again. Hooks installed with `module.registerHooks()` also run for `require()`, so after the switch from `module.register()` the hook applied its `.ts`-first extension probing to relative `require()` calls too: with both `b.js` and `b.ts` in a directory, `require("./b")` loaded `b.ts` instead of `b.js`. CommonJS now follows Node's own order (`.js`, `.json`, `.node`, then `package.json` `main`); ESM `import` resolution is unchanged.
