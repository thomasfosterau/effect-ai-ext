/**
 * @copyright Thomas Foster
 *
 * `EvalCase` — a {@link Golden.Golden} enriched with the actuals produced by
 * running the system under test: the real `output`, whatever context was
 * retrieved along the way, any tool calls made, and timing/usage. Scorers
 * read an `EvalCase`, never a bare `Golden` — the golden/test-case split
 * keeps datasets static while runs carry the run-specific actuals (DeepEval's
 * `Golden` / `LLMTestCase`).
 *
 * @module EvalCase
 */

import * as Schema from "effect/Schema";

/**
 * One tool call observed during a run. Deliberately structural (`name` /
 * `params` / `result`, no generic `Toolkit` parameter) rather than typed
 * against a specific `effect/unstable/ai` `Toolkit`, so goldens and cases
 * stay plain, serialisable data — a `Toolkit` type parameter would force
 * every `Golden`/`EvalCase` consumer to close over the same tool set.
 * `scorers/ToolCallCorrectness.ts` (#925) compares against this shape
 * directly rather than extending it.
 */
export const ToolCall = Schema.Struct({
  name: Schema.String,
  params: Schema.Unknown,
  result: Schema.optional(Schema.Unknown),
});

/** The decoded type of {@link ToolCall}. */
export type ToolCall = typeof ToolCall.Type;

/** Token/latency accounting observed during a run. */
export const Usage = Schema.Struct({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
});

/** The decoded type of {@link Usage}. */
export type Usage = typeof Usage.Type;

/**
 * An {@link EvalCase} pairs a golden (of the given schema) with the actual
 * `output` produced by the system under test (of the given schema), plus the
 * optional run-time observations a scorer might need.
 */
export const EvalCase = <GoldenSchema extends Schema.Top, OutputSchema extends Schema.Top>(
  golden: GoldenSchema,
  output: OutputSchema,
) =>
  Schema.Struct({
    golden,
    output,
    retrievedContext: Schema.optional(Schema.Array(Schema.String)),
    toolCalls: Schema.optional(Schema.Array(ToolCall)),
    durationMillis: Schema.optional(Schema.Number),
    usage: Schema.optional(Usage),
  });

/** The decoded type of an {@link EvalCase} built from the given field schemas. */
export type EvalCase<GoldenSchema extends Schema.Top, OutputSchema extends Schema.Top> = ReturnType<
  typeof EvalCase<GoldenSchema, OutputSchema>
>["Type"];
