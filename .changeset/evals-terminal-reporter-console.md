---
"@thomasfosterau/effect-evals": patch
---

The `terminal` reporter now writes through Effect's `Console` service (`Console.log`) instead of calling `console.log` directly, so a program that provides its own `Console` receives the table there; with the default `Console` the output is unchanged (#98).
