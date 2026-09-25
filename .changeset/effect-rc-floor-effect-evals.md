---
"@thomasfosterau/effect-evals": minor
---

**Breaking:** the `effect` peer dependency moves from `>=4.0.0-beta.104` to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.

- The `@effect/platform-node` dependency moves from `4.0.0-beta.107` to `4.0.0-rc.115`, the same Effect line the rest of the workspace builds on.
- The CLI's flags use the rc constructors (`Flag.String` / `Int` / `Boolean` / `Literals`, `Argument.String`). rc.113 removed the lower-case spellings. The `effect-evals` command line is unchanged.
