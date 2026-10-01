/**
 * `jsonValidity` — does a case's `output` parse as JSON at all? The cheapest
 * possible sanity check before a stricter {@link SchemaMatch.schemaMatch}
 * decode (autoevals' `JSONDiff` family starts from the same "is it even
 * JSON" question). Never fails: an unparseable `output` scores `0` with the
 * parse error as `reason`.
 *
 * @module scorers/JsonValidity
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import { makeScorer, type Scorer } from "../Scorer.ts";

/** The shape `jsonValidity` needs from a case: a string `output` to attempt to parse. */
export interface JsonCase {
  readonly output: string;
}

/** Whether `evalCase.output` parses as JSON. */
export const jsonValidity: Scorer<JsonCase> = makeScorer({
  name: "json-validity",
  evaluate: (evalCase) =>
    Effect.try({
      try: (): unknown => JSON.parse(evalCase.output),
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    }).pipe(
      Effect.map(() => ({ score: 1 })),
      Effect.catch((reason) => Effect.succeed({ score: 0, reason })),
    ),
});
