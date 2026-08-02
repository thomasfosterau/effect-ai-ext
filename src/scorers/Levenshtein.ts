/**
 * @copyright Thomas Foster
 *
 * `levenshtein` — normalised edit-distance similarity between a case's
 * `output` and its golden's `expected` (autoevals' `Levenshtein`).
 * Implemented in-package (a single-row Wagner–Fischer DP, ~20 lines) rather
 * than pulling in a dependency for it.
 *
 * @module scorers/Levenshtein
 */

import * as Effect from "effect/Effect";
import { makeScorer, type Scorer } from "../Scorer.ts";
import type { StringCase } from "./StringCase.ts";

/**
 * The classic edit-distance DP, single-row-optimised: `O(a.length * b.length)`
 * time, `O(min(a,b).length)` space — the row is sized to the *shorter*
 * string, so the two inputs are swapped first when `a` is longer than `b`.
 */
const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (a.length < b.length) [a, b] = [b, a];

  let previousRow = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        previousRow[j]! + 1,
        currentRow[j - 1]! + 1,
        previousRow[j - 1]! + substitutionCost,
      );
    }
    previousRow = currentRow;
  }

  return previousRow[b.length]!;
};

/** Edit distance normalised to a `[0, 1]` similarity: `1` for identical strings, `0` for maximally different ones. */
export const levenshteinSimilarity = (a: string, b: string): number => {
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - levenshteinDistance(a, b) / maxLength;
};

/** Normalised Levenshtein similarity between `evalCase.output` and `evalCase.golden.expected`. */
export const levenshtein: Scorer<StringCase> = makeScorer({
  name: "levenshtein",
  evaluate: (evalCase) =>
    Effect.sync(() => {
      const { expected } = evalCase.golden;
      if (expected === undefined) {
        return { score: 0, reason: "golden.expected is undefined" };
      }
      return { score: levenshteinSimilarity(expected, evalCase.output) };
    }),
});
