import { defineConfig } from "tsup";

// Bundle the single-barrel entry to Node-ESM-loadable output: esbuild emits the
// JS, rollup-plugin-dts (running on the TS6 JS-API compiler) bundles the types.
// `effect` / `@effect/*` and the workspace `@thomasfosterau/*` packages stay
// external so the published package shares the consumer's singleton copies.
// `ignoreDeprecations` silences TS6's `baseUrl` deprecation error raised by the
// declaration bundler.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "esnext",
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  clean: true,
  treeshake: true,
  external: [/^effect/, /^@effect/, /^@thomasfosterau/],
});
