import { defineConfig } from "vite-plus";
import { packageTest } from "@thomasfosterau/test-config";

export default defineConfig({
  test: packageTest({
    thresholds: { statements: 94, branches: 78, functions: 90, lines: 94 },
    needsMocks: true,
    coverageExclude: ["src/cli/main.ts"],
  }),
});
