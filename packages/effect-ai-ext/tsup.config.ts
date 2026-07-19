import { defineConfig } from "tsup";

// Multi-entry build (mirrors how `effect` itself ships per-module subpaths):
// esbuild emits one Node-ESM file per module, rollup-plugin-dts (on the TS6
// JS-API compiler) bundles a matching `.d.ts`. `effect` / `@effect/*` stay
// external so the published package shares the consumer's singleton copies.
// `ignoreDeprecations` silences TS6's `baseUrl` deprecation error raised by
// the declaration bundler.
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/RerankerModel.ts",
    "src/ClassifierModel.ts",
    "src/SpeechModel.ts",
    "src/TranscriptionModel.ts",
    "src/ImageModel.ts",
    "src/ModerationModel.ts",
    "src/VoiceConversionModel.ts",
  ],
  format: ["esm"],
  target: "esnext",
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  clean: true,
  treeshake: true,
  external: [/^effect/, /^@effect/],
});
