/**
 * @copyright Thomas Foster
 *
 * The structural case shape the RAG metric suite reads from, and the
 * required-field lookup shared by every metric in `metrics/rag/` —
 * `GEval.ts`'s `GEvalCase` / `collectFields` pattern applied to the fields a
 * RAG judge cares about (`input`, `output`, `expected`, `retrievedContext`).
 * Reuses `GEval.MissingEvaluationParamError`, `GEval.isMissing`, and
 * `GEval.renderValue` directly rather than declaring parallel copies: a case
 * missing a field, or a case field needing judge-prompt rendering, is the
 * same concern regardless of which judge metric is asking.
 *
 * @module metrics/rag/RagCase
 */

import * as Effect from "effect/Effect";
import { AiError } from "effect/unstable/ai";
import { isMissing, MissingEvaluationParamError, renderValue } from "../GEval.ts";
import type { VerdictCountMismatchError } from "./ExtractThenClassify.ts";

/** The failure modes of any RAG metric in `metrics/rag/`. */
export type RagMetricError =
  | MissingEvaluationParamError
  | VerdictCountMismatchError
  | AiError.AiError;

export { renderValue };

/**
 * The structural shape every RAG metric reads from — matches
 * `EvalCase.EvalCase(Golden.Golden(...), ...)`'s decoded type (which carries
 * additional fields these metrics ignore). `retrievedContext` is an ordered
 * array: `ContextualPrecision` treats earlier entries as higher-ranked.
 */
export interface RagCase {
  readonly golden: {
    readonly input: unknown;
    readonly expected?: unknown;
  };
  readonly output: unknown;
  readonly retrievedContext?: ReadonlyArray<string>;
}

/** Fails with the typed error when `evalCase.golden.input` is absent. */
export const requireInput = (
  metricName: string,
  evalCase: RagCase,
): Effect.Effect<unknown, MissingEvaluationParamError> =>
  isMissing(evalCase.golden.input)
    ? new MissingEvaluationParamError({ metric: metricName, param: "input" })
    : Effect.succeed(evalCase.golden.input);

/** Fails with the typed error when `evalCase.output` is absent. */
export const requireOutput = (
  metricName: string,
  evalCase: RagCase,
): Effect.Effect<unknown, MissingEvaluationParamError> =>
  isMissing(evalCase.output)
    ? new MissingEvaluationParamError({ metric: metricName, param: "output" })
    : Effect.succeed(evalCase.output);

/** Fails with the typed error when `evalCase.golden.expected` is absent. */
export const requireExpected = (
  metricName: string,
  evalCase: RagCase,
): Effect.Effect<unknown, MissingEvaluationParamError> =>
  isMissing(evalCase.golden.expected)
    ? new MissingEvaluationParamError({ metric: metricName, param: "expected" })
    : Effect.succeed(evalCase.golden.expected);

/** Fails with the typed error when `evalCase.retrievedContext` is absent. */
export const requireRetrievedContext = (
  metricName: string,
  evalCase: RagCase,
): Effect.Effect<ReadonlyArray<string>, MissingEvaluationParamError> =>
  isMissing(evalCase.retrievedContext)
    ? new MissingEvaluationParamError({ metric: metricName, param: "retrievedContext" })
    : Effect.succeed(evalCase.retrievedContext!);

/** Renders an ordered `retrievedContext` array as numbered chunks, preserving rank order. */
export const renderContext = (chunks: ReadonlyArray<string>): string =>
  chunks.map((chunk, index) => `[${index + 1}] ${chunk}`).join("\n");
