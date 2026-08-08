import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Narrow on purpose. `tests/eval-glob-separation.test.ts` pins this exact
    // value so a widened glob can never start picking up `*.eval.ts` files,
    // which may need real provider credentials to run.
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts", "src/cli/main.ts"],
      reporter: ["text-summary"],
    },
  },
});
