/**
 * `exactMatch` / `normalizedMatch` — the cheapest possible scorers: strict
 * string equality between a case's `output` and its golden's `expected`, and
 * a normalising variant that trims and/or case-folds both sides first
 * (autoevals' `ExactMatch`). Never fails — a missing `golden.expected`
 * scores `0` with a reason rather than throwing, since "nothing to compare
 * against" is a scoring outcome, not an error.
 *
 * @module scorers/ExactMatch
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import { makeScorer, type Scorer } from "../Scorer.ts";
import type { StringCase } from "./StringCase.ts";

/** Options for {@link normalizedMatch}: which normalisations to apply to both sides before comparing. */
export interface NormalizedMatchOptions {
  readonly trim?: boolean;
  readonly caseInsensitive?: boolean;
}

const normalize = (value: string, options: NormalizedMatchOptions): string => {
  const trimmed = options.trim ? value.trim() : value;
  return options.caseInsensitive ? trimmed.toLowerCase() : trimmed;
};

/** Shared by {@link exactMatch} and {@link normalizedMatch} — `exactMatch` is just this with no normalisation applied. */
const compare =
  (options: NormalizedMatchOptions): Scorer<StringCase>["evaluate"] =>
  (evalCase) =>
    Effect.sync(() => {
      const { expected } = evalCase.golden;
      if (expected === undefined) {
        return { score: 0, reason: "golden.expected is undefined" };
      }
      return normalize(expected, options) === normalize(evalCase.output, options)
        ? { score: 1, reason: "matched" }
        : { score: 0, reason: "mismatched" };
    });

/** Strict equality between `evalCase.output` and `evalCase.golden.expected`. */
export const exactMatch: Scorer<StringCase> = makeScorer({
  name: "exact-match",
  evaluate: compare({}),
});

/**
 * Equality between `evalCase.output` and `evalCase.golden.expected` after
 * applying the given normalisations to both sides — trims whitespace and/or
 * folds case before comparing, so cosmetic differences don't fail the match.
 */
export const normalizedMatch = (options: NormalizedMatchOptions = {}): Scorer<StringCase> =>
  makeScorer({ name: "normalized-match", evaluate: compare(options) });
