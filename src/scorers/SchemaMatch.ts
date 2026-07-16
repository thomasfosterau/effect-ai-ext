/**
 * @copyright Thomas Foster
 *
 * `schemaMatch` — does a case's `output` decode against a caller-supplied
 * Effect `Schema`? Parses `output` as JSON and decodes it against `schema`
 * in one step via `Schema.fromJsonString` (the {@link JsonValidity.jsonValidity}
 * sibling checks only the "is it JSON at all" half). Uses `Schema` from
 * `effect`, never `effect/unstable/schema`. Never fails: a decode failure
 * scores `0` with the decode error's message as `reason`.
 *
 * @module scorers/SchemaMatch
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { makeScorer, type Scorer } from "../Scorer";
import type { JsonCase } from "./JsonValidity";

/**
 * Builds a scorer that decodes `evalCase.output` (a JSON string) against
 * `schema`, scoring `1` when it decodes and `0` (with the decode error's
 * message as `reason`) when it doesn't.
 */
export const schemaMatch = <S extends Schema.Top>(
  schema: S,
): Scorer<JsonCase, never, S["DecodingServices"]> => {
  const fromJsonString = Schema.fromJsonString(schema);

  return makeScorer({
    name: "schema-match",
    evaluate: (evalCase) =>
      Schema.decodeUnknownEffect(fromJsonString)(evalCase.output).pipe(
        Effect.map(() => ({ score: 1 })),
        Effect.catch((error) => Effect.succeed({ score: 0, reason: error.message })),
      ),
  });
};
