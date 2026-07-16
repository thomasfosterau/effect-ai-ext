/**
 * @copyright Thomas Foster
 *
 * Free-form metadata carried alongside a {@link Golden.Golden},
 * {@link Scorer.Scorer}, or {@link Score.Score} — a scorer's diagnostic
 * detail, a golden's provenance, whatever a caller wants attached without
 * the core model needing to know its shape.
 *
 * @module Metadata
 */

import * as Schema from "effect/Schema";

/** Free-form metadata: a string-keyed record of unknown values. */
export const Metadata = Schema.Record(Schema.String, Schema.Unknown);

/** The decoded type of {@link Metadata}. */
export type Metadata = typeof Metadata.Type;
