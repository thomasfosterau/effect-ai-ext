/**
 * @copyright Thomas Foster
 *
 * `Scorer` — a named function from an {@link EvalCase.EvalCase} to a
 * {@link Score.Score}, expressed as a plain Effect value: judge or embedding
 * dependencies (e.g. `LanguageModel.LanguageModel` from `effect/unstable/ai`)
 * live in `R`, and failures are typed in `E` rather than thrown — no
 * `self.error` mutation, no exceptions escaping a scorer's control flow.
 *
 * This module carries only the shape; concrete scorers (deterministic,
 * G-Eval, RAG, tool-call correctness) are later slices (#925-#927).
 *
 * @module Scorer
 */

import type * as Effect from "effect/Effect";
import type { Score } from "./Score";

/**
 * A named scorer over cases of type `Case`. `evaluate` may depend on
 * services in `R` (most commonly a judge `LanguageModel`) and can fail with
 * a typed error `E`.
 */
export interface Scorer<in Case, out E = never, out R = never> {
  readonly name: string;
  readonly evaluate: (evalCase: Case) => Effect.Effect<Score, E, R>;
}

/** Constructs a {@link Scorer} from its name and evaluation function. */
export const makeScorer = <Case, E = never, R = never>(options: {
  readonly name: string;
  readonly evaluate: (evalCase: Case) => Effect.Effect<Score, E, R>;
}): Scorer<Case, E, R> => options;
