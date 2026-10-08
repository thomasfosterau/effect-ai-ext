/**
 * `jsonValidity` — does a case's `output` parse as JSON at all? The cheapest
 * possible sanity check before a stricter {@link SchemaMatch.schemaMatch}
 * decode (autoevals' `JSONDiff` family starts from the same "is it even
 * JSON" question). An unparseable `output` (the `SyntaxError` `JSON.parse`
 * throws) scores `0` with the parse error as `reason`. Anything else thrown
 * while parsing is not a verdict on the output, so it is a defect that
 * fails the run rather than a silent `0` (#98).
 *
 * @module scorers/JsonValidity
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as Scorer from "../Scorer.ts";

/** The shape `jsonValidity` needs from a case: a string `output` to attempt to parse. */
export interface JsonCase {
  readonly output: string;
}

/** The one failure `JSON.parse` reports for unparseable text. */
const isSyntaxError = (cause: unknown): cause is SyntaxError => cause instanceof SyntaxError;

/** Whether `evalCase.output` parses as JSON. */
export const jsonValidity: Scorer.Scorer<JsonCase> = Scorer.makeScorer({
  name: "json-validity",
  evaluate: (evalCase) =>
    Effect.try({
      try: (): unknown => JSON.parse(evalCase.output),
      catch: (cause) => cause,
    }).pipe(
      Effect.map(() => ({ score: 1 })),
      Effect.catchIf(isSyntaxError, (error) => Effect.succeed({ score: 0, reason: error.message })),
      Effect.orDie,
    ),
});
