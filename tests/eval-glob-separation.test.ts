/**
 * Pins the glob boundary between the unit suite and eval files (#929
 * acceptance criterion): the vite.config.ts `test.include` must stay narrow
 * enough that `vp run test:unit` never picks up `evals/**\/*.eval.ts` files
 * (which may need real provider credentials) alongside `tests/**\/*.test.ts`.
 * If this test breaks, `include` changed — check the new value still
 * excludes `evals/` before updating the assertion.
 *
 * @module tests/eval-glob-separation
 */

import { describe, expect, it } from "vite-plus/test";
import viteConfig from "../vite.config.ts";

describe("eval/test glob separation", () => {
  const include = viteConfig.test!.include!;

  it("is exactly the narrow tests-only glob", () => {
    expect(include).toEqual(["tests/**/*.test.ts"]);
  });

  it("does not match an eval file", () => {
    expect(include.some((pattern) => pattern.includes("eval"))).toBe(false);
  });
});
