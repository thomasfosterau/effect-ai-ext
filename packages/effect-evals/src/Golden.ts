/**
 * @copyright Thomas Foster
 *
 * `Golden` — the static, hand-authored (or dataset-loaded) description of one
 * evaluation case: an input, optionally an expected output, and whatever
 * retrieval/tool context a scorer needs to judge a run. `ConversationalGolden`
 * is the multi-turn variant, holding its turn history as `Prompt.Prompt` from
 * `effect/unstable/ai` so a golden's conversation shape never drifts from the
 * shape a `LanguageModel` actually consumes.
 *
 * Goldens are enriched into {@link EvalCase.EvalCase}s by running the system
 * under test — datasets stay static, runs produce the actuals (DeepEval's
 * golden/test-case split).
 *
 * @module Golden
 */

import * as Schema from "effect/Schema";
import * as Prompt from "effect/unstable/ai/Prompt";
import { Metadata } from "./Metadata.ts";

/**
 * A single-turn golden, parameterised by the schema of its `input` and
 * `expected` output. Pass `Schema.Unknown` for either side when the case
 * doesn't need a typed shape.
 */
export const Golden = <InputSchema extends Schema.Top, ExpectedSchema extends Schema.Top>(
  input: InputSchema,
  expected: ExpectedSchema,
) =>
  Schema.Struct({
    input,
    expected: Schema.optional(expected),
    context: Schema.optional(Schema.Array(Schema.String)),
    expectedTools: Schema.optional(Schema.Array(Schema.String)),
    metadata: Schema.optional(Metadata),
  });

/** The decoded type of a {@link Golden} built from the given field schemas. */
export type Golden<InputSchema extends Schema.Top, ExpectedSchema extends Schema.Top> = ReturnType<
  typeof Golden<InputSchema, ExpectedSchema>
>["Type"];

/**
 * A multi-turn golden: a conversation history aligned with `Prompt.Prompt`
 * (so it decodes/encodes exactly like the prompt a `LanguageModel` would
 * receive), plus the scenario being tested and the outcome expected at the
 * end of the conversation.
 */
export const ConversationalGolden = <ExpectedOutcomeSchema extends Schema.Top>(
  expectedOutcome: ExpectedOutcomeSchema,
) =>
  Schema.Struct({
    turns: Prompt.Prompt,
    scenario: Schema.optional(Schema.String),
    expectedOutcome: Schema.optional(expectedOutcome),
    context: Schema.optional(Schema.Array(Schema.String)),
    metadata: Schema.optional(Metadata),
  });

/** The decoded type of a {@link ConversationalGolden} built from the given expected-outcome schema. */
export type ConversationalGolden<ExpectedOutcomeSchema extends Schema.Top> = ReturnType<
  typeof ConversationalGolden<ExpectedOutcomeSchema>
>["Type"];
