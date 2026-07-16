/**
 * The `./viteplus` sub-export is a placeholder until #929 implements the
 * `vite-plus/test` runner adapter — it should throw rather than silently do
 * nothing.
 *
 * @module tests/viteplus
 */

import { describe, expect, it } from "vite-plus/test";
import { notImplemented } from "@thomasfosterau/effect-evals/viteplus";

describe("viteplus placeholder", () => {
  it("throws until the adapter is implemented", () => {
    expect(() => notImplemented()).toThrow(/not implemented yet/);
  });
});
