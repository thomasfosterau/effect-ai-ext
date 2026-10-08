/**
 * `schemaMatch` — does a case's `output` decode against a caller-supplied
 * Effect `Schema`? Parses `output` as JSON and decodes it against `schema`
 * in one step via `Schema.fromJsonString` (the {@link JsonValidity.jsonValidity}
 * sibling checks only the "is it JSON at all" half). `schemaMatchValue` is the
 * same decode over a case whose `output` is already a structured value, no
 * JSON string round trip. Uses `Schema` from `effect`, never
 * `effect/schema`. A decode failure (`SchemaError`) scores `0` with the
 * decode error's message as `reason`; nothing else is caught, so a defect
 * in a schema's own transformation fails the run (#98).
 *
 * @module scorers/SchemaMatch
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Scorer from "../Scorer.ts";
import type { Score } from "../Score.ts";
import type { JsonCase } from "./JsonValidity.ts";

/** Scores `1` when `decoded` succeeds, `0` with the decode error's message as `reason` when it doesn't — shared by {@link schemaMatch} and {@link schemaMatchValue}. */
const scoreDecodeResult = <A, R>(
  decoded: Effect.Effect<A, Schema.SchemaError, R>,
): Effect.Effect<Score, never, R> =>
  decoded.pipe(
    Effect.map(() => ({ score: 1 })),
    Effect.catchTag("SchemaError", (error) => Effect.succeed({ score: 0, reason: error.message })),
  );

/**
 * Builds a scorer that decodes `evalCase.output` (a JSON string) against
 * `schema`, scoring `1` when it decodes and `0` (with the decode error's
 * message as `reason`) when it doesn't.
 */
export const schemaMatch = <S extends Schema.Top>(
  schema: S,
): Scorer.Scorer<JsonCase, never, S["DecodingServices"]> => {
  const fromJsonString = Schema.fromJsonString(schema);

  return Scorer.makeScorer({
    name: "schema-match",
    evaluate: (evalCase) =>
      scoreDecodeResult(Schema.decodeUnknownEffect(fromJsonString)(evalCase.output)),
  });
};

/** The shape a decode-from-value scorer needs from a case: an already-structured `output` — see {@link schemaMatchValue}. */
export interface ValueCase {
  readonly output: unknown;
}

/**
 * Builds a scorer that decodes `evalCase.output` directly against `schema`
 * via `Schema.decodeUnknownEffect` — the {@link schemaMatch} sibling for a
 * case whose `output` is already a structured value (e.g. the object shape a
 * system-under-test actually returns) rather than a JSON string, so a
 * consumer doesn't need to round-trip it through `JSON.stringify` solely to
 * satisfy {@link JsonCase}. Scores `0` (with the decode error's message as
 * `reason`) on a decode failure, same as `schemaMatch`.
 */
export const schemaMatchValue = <S extends Schema.Top>(
  schema: S,
): Scorer.Scorer<ValueCase, never, S["DecodingServices"]> =>
  Scorer.makeScorer({
    name: "schema-match",
    evaluate: (evalCase) => scoreDecodeResult(Schema.decodeUnknownEffect(schema)(evalCase.output)),
  });
