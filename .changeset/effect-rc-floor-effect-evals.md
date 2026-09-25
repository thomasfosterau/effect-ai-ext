---
"@thomasfosterau/effect-evals": minor
---

**Breaking:** the `effect` peer dependency moves from `>=4.0.0-beta.104` to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.

- **Breaking: `@effect/platform-node` is now an optional peer dependency (`>=4.0.0-rc.113`) instead of a dependency.** It was published as an exact pin, whose own `effect` peer — and the `@effect/platform-node-shared` it floats to the newest rc — rejected any `effect` older than that pin, so npm reported ERESOLVE / ELSPROBLEMS for consumers on an older rc. Only the `effect-evals` CLI needs it: install `@effect/platform-node` at your `effect` version (and pin `@effect/platform-node-shared` to it too). The library entry needs nothing extra.
- The CLI's flags use the rc constructors (`Flag.String` / `Int` / `Boolean` / `Literals`, `Argument.String`). rc.113 removed the lower-case spellings. The `effect-evals` command line is unchanged.
