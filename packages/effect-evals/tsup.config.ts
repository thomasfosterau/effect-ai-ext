import { defineConfig } from "tsup";

// Bundle the single-barrel entry to Node-ESM-loadable output: esbuild emits the
// JS, rollup-plugin-dts (running on the TS6 JS-API compiler) bundles the types.
// `effect` / `@effect/*` and the workspace `@thomasfosterau/*` packages stay
// external so the published package shares the consumer's singleton copies.
// `ignoreDeprecations` silences TS6's `baseUrl` deprecation error raised by the
// declaration bundler.
//
// Two entries: the barrel (`dist/index.js`) and the CLI (`dist/cli/main.js`),
// which `bin/effect-evals.js` runs. The CLI MUST be built: Node refuses to
// type-strip anything under `node_modules` (issue #42), so a raw-TypeScript
// bin only ever worked inside the workspace. esbuild's ESM code splitting puts
// the modules the two entries share in common chunks, so the library an
// `*.eval.ts` file imports by package name and the one the CLI runs are the
// same module instances (one `Cache` service tag, not two).
export default defineConfig({
  entry: { index: "src/index.ts", "cli/main": "src/cli/main.ts" },
  splitting: true,
  format: ["esm"],
  target: "esnext",
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  clean: true,
  treeshake: true,
  external: [/^effect/, /^@effect/, /^@thomasfosterau/],
});
