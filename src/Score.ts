/**
 * @copyright Thomas Foster
 *
 * `Score` — the result of running one {@link Scorer.Scorer} against one
 * {@link EvalCase.EvalCase}: a normalised `0..1` number, an optional
 * human-readable `reason` (a judge's rationale, or a deterministic scorer's
 * diagnostic), and free-form `metadata`.
 *
 * @module Score
 */

import * as Schema from "effect/Schema";
import { Metadata } from "./Metadata.ts";

/** A score in `[0, 1]`, `0` worst and `1` best regardless of the metric's polarity. */
export const Score = Schema.Struct({
  score: Schema.Finite.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  reason: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
});

/** The decoded type of {@link Score}. */
export type Score = typeof Score.Type;
