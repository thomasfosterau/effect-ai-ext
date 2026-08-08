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
import type { Score } from "./Score.ts";

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

/**
 * Adapts a {@link Scorer} over `CaseB` into one over `CaseA` by transforming
 * the input case through `from` before evaluating — the same shape/name/`E`/`R`,
 * just fed a differently-shaped case. Exploits `Scorer`'s existing
 * contravariance in `Case` (above) to let a consumer whose case doesn't
 * exactly match a scorer's expected shape reuse it, rather than hand-rolling
 * the same reshape-then-delegate wrapper per call site.
 */
export const contramap = <CaseA, CaseB, E, R>(
  scorer: Scorer<CaseB, E, R>,
  from: (evalCase: CaseA) => CaseB,
): Scorer<CaseA, E, R> => ({
  name: scorer.name,
  evaluate: (evalCase) => scorer.evaluate(from(evalCase)),
});
