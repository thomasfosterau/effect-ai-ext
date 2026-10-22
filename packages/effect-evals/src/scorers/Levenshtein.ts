/**
 * `levenshtein` — normalised edit-distance similarity between a case's
 * `output` and its golden's `expected` (autoevals' `Levenshtein`).
 * Implemented in-package (a single-row Wagner–Fischer DP, ~20 lines) rather
 * than pulling in a dependency for it.
 *
 * @module scorers/Levenshtein
 *
 * @copyright Thomas Foster
 */

import * as Arr from "effect/Array";
import * as Str from "effect/String";
import * as Effect from "effect/Effect";
import * as Scorer from "../Scorer.ts";
import type { StringCase } from "./StringCase.ts";

/**
 * The classic edit-distance DP, single-row-optimised: `O(a.length * b.length)`
 * time, `O(min(a,b).length)` space — the row is sized to the *shorter*
 * string, so the two inputs are swapped first when `a` is longer than `b`.
 */
const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (Str.isEmpty(a)) return b.length;
  if (Str.isEmpty(b)) return a.length;
  if (a.length < b.length) [a, b] = [b, a];

  const longer = a;
  const shorter = b;
  const firstRow = Arr.range(0, shorter.length);
  const shorterChars = Str.split(shorter, "");
  const lastRow = Arr.reduce(
    Str.split(longer, ""),
    firstRow,
    (previousRow: Arr.NonEmptyReadonlyArray<number>, longerChar, i) =>
      // Each cell is the minimum of the cell above (deletion), the cell to
      // the left (insertion, the scan's accumulator) and the diagonal
      // (substitution, free when the characters match).
      Arr.scan(
        Arr.zip(shorterChars, Arr.zip(previousRow, Arr.drop(previousRow, 1))),
        i + 1,
        (left, [shorterChar, [diagonal, above]]) =>
          Math.min(above + 1, left + 1, diagonal + (longerChar === shorterChar ? 0 : 1)),
      ),
  );

  return Arr.lastNonEmpty(lastRow);
};

/** Edit distance normalised to a `[0, 1]` similarity: `1` for identical strings, `0` for maximally different ones. */
export const levenshteinSimilarity = (a: string, b: string): number => {
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - levenshteinDistance(a, b) / maxLength;
};

/** Normalised Levenshtein similarity between `evalCase.output` and `evalCase.golden.expected`. */
export const levenshtein: Scorer.Scorer<StringCase> = Scorer.makeScorer({
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
