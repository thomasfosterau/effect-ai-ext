/**
 * Pins the glob boundary between the unit suite and eval files (#929
 * acceptance criterion): `test.include` in vite.config.ts (from the shared
 * vite.package.ts) must stay narrow enough that `vp test` never picks up `evals/**\/*.eval.ts` files
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
    // The exact pin is the whole gate: any glob equal to this cannot match
    // `evals/*.eval.ts`. (A substring check on the pattern text would prove
    // nothing — "**/*.ts" contains no "eval" yet matches every eval file.)
    expect(include).toEqual(["tests/**/*.test.ts"]);
  });
});
