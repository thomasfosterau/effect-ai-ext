/**
 * Pins the glob boundary between the unit suite and eval files (#929
 * acceptance criterion): `packageTest`'s `include` must stay narrow enough
 * that `vp run test:unit` never picks up `evals/**\/*.eval.ts` files (which
 * may need real provider credentials) alongside `tests/**\/*.test.ts`. If
 * this test breaks, `packageTest`'s `include` changed — check the new value
 * still excludes `evals/` before updating the assertion.
 *
 * @module tests/eval-glob-separation
 */

import { describe, expect, it } from "vite-plus/test";
import { packageTest } from "@thomasfosterau/test-config";

describe("eval/test glob separation", () => {
  const { include } = packageTest({
    thresholds: { statements: 0, branches: 0, functions: 0, lines: 0 },
  });

  it("is exactly the narrow tests-only glob", () => {
    expect(include).toEqual(["tests/**/*.test.ts"]);
  });

  it("does not match an eval file", () => {
    expect(include.some((pattern) => pattern.includes("eval"))).toBe(false);
  });
});
