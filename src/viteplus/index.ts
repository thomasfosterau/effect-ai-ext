/**
 * @copyright Thomas Foster
 *
 * Placeholder for the `vite-plus/test` runner adapter. The sanctioned
 * `./viteplus` sub-export exists from this issue (#923) onward so the core
 * barrel (`.`) never has to import `vite-plus/test` — see
 * `docs/decisions/single-barrel-package-exports.md` and
 * `docs/decisions/effect-evals-as-the-evaluation-toolkit.md`. The adapter
 * itself (generating `describe`/`it` suites from a `Dataset` + `Metric[]`
 * over `vite-plus/test`) is implemented in #929, once the runner (#924)
 * exists for it to call.
 *
 * @module viteplus
 */

export const notImplemented = (): never => {
  throw new Error(
    "@thomasfosterau/effect-evals/viteplus is not implemented yet — see https://github.com/thomasfosterau/website/issues/929",
  );
};
