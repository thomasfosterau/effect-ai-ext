/**
 * @copyright Thomas Foster
 *
 * `Dataset` — a named source of goldens for a runner (#924) to iterate.
 * Just a seam for now: goldens can be given inline, or as an Effect that
 * yields them (file-loading, a remote source, synthetic generation later —
 * whatever produces `ReadonlyArray<Golden>` fits here unchanged).
 *
 * @module Dataset
 */

import * as Effect from "effect/Effect";

/** A named, effectfully-produced collection of goldens. */
export interface Dataset<Golden, E = never, R = never> {
  readonly name: string;
  readonly goldens: Effect.Effect<ReadonlyArray<Golden>, E, R>;
}

/** Constructs a {@link Dataset} from a name and an effect yielding its goldens. */
export const makeDataset = <Golden, E = never, R = never>(options: {
  readonly name: string;
  readonly goldens: Effect.Effect<ReadonlyArray<Golden>, E, R>;
}): Dataset<Golden, E, R> => options;

/** Constructs a {@link Dataset} from an inline, already-known array of goldens. */
export const fromArray = <Golden>(name: string, goldens: ReadonlyArray<Golden>): Dataset<Golden> =>
  makeDataset({ name, goldens: Effect.succeed(goldens) });
