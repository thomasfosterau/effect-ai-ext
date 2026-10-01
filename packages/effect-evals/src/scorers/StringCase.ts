/**
 * The case shape shared by every scorer that compares a string `output`
 * against an optional string `golden.expected`: {@link ExactMatch.exactMatch}
 * / {@link ExactMatch.normalizedMatch}, {@link Levenshtein.levenshtein}, and
 * {@link EmbeddingSimilarity.embeddingSimilarity}.
 *
 * @module scorers/StringCase
 *
 * @copyright Thomas Foster
 */

/** The shape a string-comparison scorer needs from a case: a string `output` compared against an optional string `golden.expected`. */
export interface StringCase {
  readonly golden: { readonly expected?: string };
  readonly output: string;
}
