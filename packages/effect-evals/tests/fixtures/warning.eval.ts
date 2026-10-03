/**
 * @copyright Thomas Foster
 *
 * A fixture that emits a `DeprecationWarning` when it loads, for
 * `tests/cli/bin.test.ts`: the `effect-evals` bin may hide Node's
 * `ExperimentalWarning`s but must let every other warning through to stderr
 * (#81). Its one suite is empty, so the run itself passes.
 *
 * @module tests/fixtures/warning.eval
 */

import * as Layer from "effect/Layer";
import type { EvalFile } from "../../src/index.ts";

process.emitWarning("effect-evals fixture warning", "DeprecationWarning");

export default {
  suites: [],
  layer: Layer.empty,
} satisfies EvalFile.EvalFile;
