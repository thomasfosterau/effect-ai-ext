/**
 * The shared judge primitive nearly every DeepEval RAG metric reduces to:
 * *extract atomic statements from one case field, classify each against
 * another field, score = ratio of favourable verdicts to total*
 * (faithfulness, answer relevancy, contextual recall, and contextual
 * relevancy — see their modules — are each a thin configuration of
 * {@link extractThenClassifyRatio}; `ContextualPrecision.ts` reuses only
 * {@link classifyStatements}, since its items are already the ranked
 * `retrievedContext` chunks with nothing to extract).
 *
 * Follows `GEval.judge`'s request/response mechanics (one
 * `LanguageModel.generateObject` call per step, a `Schema.Struct` response,
 * never string-parsed) rather than that function's exact signature, per its
 * module doc's anticipation of this suite (website#927): the response shape
 * here is a per-statement verdict list, not a single score.
 *
 * @module metrics/rag/ExtractThenClassify
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AiError, LanguageModel } from "effect/ai";
import type * as Prompt from "effect/ai/Prompt";
import type { Score } from "../../Score.ts";

// ── Structured-output schemas ────────────────────────────────────────

const Statements = Schema.Struct({
  statements: Schema.Array(Schema.String),
});

const Verdicts = Schema.Struct({
  verdicts: Schema.Array(
    Schema.Struct({
      statement: Schema.String,
      verdict: Schema.Literals(["yes", "no"]),
      reason: Schema.optional(Schema.String),
    }),
  ),
});

/** One classified statement: whether it satisfies the metric's classification question, and why. */
export interface Verdict {
  readonly statement: string;
  readonly verdict: "yes" | "no";
  readonly reason?: string | undefined;
}

/**
 * The judge returned a different number of verdicts than statements given to
 * classify — a structured-output count mismatch (dropped or invented
 * entries), analogous to `Translation`'s segment-count check
 * (`packages/jobs/src/translation/service.ts`). Raised rather than silently
 * indexing a misaligned array: `ContextualPrecision`'s score is rank-position
 * sensitive, so a dropped or reordered verdict there would silently corrupt
 * the ranking rather than just skew a ratio.
 */
export class VerdictCountMismatchError extends Schema.TaggedError<VerdictCountMismatchError>()(
  "VerdictCountMismatchError",
  {
    expected: Schema.Finite,
    actual: Schema.Finite,
  },
) {}

// ── Extraction step ──────────────────────────────────────────────────

/** Options for {@link extractStatements}. */
export interface ExtractOptions {
  /** System-prompt instructions describing what counts as an atomic statement, and from which field. */
  readonly instructions: string;
  /** Label for the field being extracted from (e.g. `"output"`). */
  readonly label: string;
  /** The rendered text to extract statements from. */
  readonly text: string;
}

/**
 * Calls the judge once via `generateObject` to extract atomic statements
 * from `options.text`. Exported for direct reuse by metrics that need
 * extraction alone.
 */
export const extractStatements = (
  options: ExtractOptions,
): Effect.Effect<ReadonlyArray<string>, AiError.AiError, LanguageModel.LanguageModel> =>
  Effect.gen(function* () {
    const model = yield* LanguageModel.LanguageModel;
    const prompt: Prompt.RawInput = [
      { role: "system", content: options.instructions },
      { role: "user", content: `${options.label}:\n${options.text}` },
    ];
    const response = yield* model.generateObject({
      prompt,
      schema: Statements,
      objectName: "extraction",
    });
    return response.value.statements;
  });

// ── Classification step ──────────────────────────────────────────────

/** Options for {@link classifyStatements}. */
export interface ClassifyOptions {
  /** System-prompt instructions describing the classification question and what "yes"/"no" mean. */
  readonly instructions: string;
  /** The statements (or, for contextual precision, the ranked chunks) to classify — order is preserved in the returned verdicts. */
  readonly statements: ReadonlyArray<string>;
  /** Label for the field being classified against (e.g. `"input"`, `"retrievedContext"`). */
  readonly referenceLabel: string;
  /** The rendered text to classify each statement against. */
  readonly referenceText: string;
  /** Label for the items being classified in the prompt (default `"statements"`) — override when classifying something else, e.g. `ContextualPrecision`'s ranked chunks. */
  readonly itemsLabel?: string;
}

/**
 * Calls the judge once via `generateObject` to classify each of
 * `options.statements` against `options.referenceText`, in the same order
 * they were given. Exported for direct reuse by `ContextualPrecision.ts`,
 * which classifies ranked `retrievedContext` chunks with nothing to extract
 * first. Fails with {@link VerdictCountMismatchError} rather than returning a
 * misaligned array when the judge's verdict count doesn't match the number
 * of items given.
 */
export const classifyStatements = (
  options: ClassifyOptions,
): Effect.Effect<
  ReadonlyArray<Verdict>,
  AiError.AiError | VerdictCountMismatchError,
  LanguageModel.LanguageModel
> =>
  Effect.gen(function* () {
    const model = yield* LanguageModel.LanguageModel;
    const itemsLabel = options.itemsLabel ?? "statements";
    const numbered = options.statements
      .map((statement, index) => `${index + 1}. ${statement}`)
      .join("\n");
    const prompt: Prompt.RawInput = [
      { role: "system", content: options.instructions },
      {
        role: "user",
        content: `${options.referenceLabel}:\n${options.referenceText}\n\n${itemsLabel}:\n${numbered}`,
      },
    ];
    const response = yield* model.generateObject({
      prompt,
      schema: Verdicts,
      objectName: "classification",
    });

    const verdicts = response.value.verdicts;
    if (verdicts.length !== options.statements.length) {
      return yield* new VerdictCountMismatchError({
        expected: options.statements.length,
        actual: verdicts.length,
      });
    }
    return verdicts;
  });

// ── Scoring ──────────────────────────────────────────────────────────

/** The ratio of `"yes"` verdicts to total, vacuously `1` when there's nothing to classify. */
export const ratioScore = (verdicts: ReadonlyArray<Verdict>): number =>
  verdicts.length === 0
    ? 1
    : verdicts.filter((verdict) => verdict.verdict === "yes").length / verdicts.length;

/** Summarises verdicts into a human-readable `Score.reason`: a pass count, then each `"no"` verdict's statement and reason. */
export const summarizeVerdicts = (verdicts: ReadonlyArray<Verdict>): string => {
  if (verdicts.length === 0) return "No statements to evaluate.";
  const passCount = verdicts.filter((verdict) => verdict.verdict === "yes").length;
  const failures = verdicts
    .filter((verdict) => verdict.verdict === "no")
    .map((verdict) =>
      verdict.reason ? `- ${verdict.statement}: ${verdict.reason}` : `- ${verdict.statement}`,
    );
  const summary = `${passCount}/${verdicts.length} statements passed.`;
  return failures.length > 0 ? [summary, ...failures].join("\n") : summary;
};

// ── Composed primitive ───────────────────────────────────────────────

/** Options for {@link extractThenClassifyRatio}. */
export interface ExtractThenClassifyOptions {
  readonly extract: ExtractOptions;
  readonly classify: Omit<ClassifyOptions, "statements">;
}

/**
 * The full extract → classify → ratio pipeline: extracts atomic statements
 * from `options.extract`, classifies each against `options.classify`, and
 * scores the ratio of `"yes"` verdicts. Skips the classification call
 * entirely (and scores a vacuous `1`) when extraction finds no statements —
 * there being nothing to contradict, misattribute, or find irrelevant is a
 * pass, not a failure to evaluate.
 */
export const extractThenClassifyRatio = (
  options: ExtractThenClassifyOptions,
): Effect.Effect<Score, AiError.AiError | VerdictCountMismatchError, LanguageModel.LanguageModel> =>
  Effect.gen(function* () {
    const statements = yield* extractStatements(options.extract);

    if (statements.length === 0) {
      return {
        score: 1,
        reason: "No statements to evaluate.",
        metadata: { statements, verdicts: [] },
      };
    }

    const verdicts = yield* classifyStatements({ ...options.classify, statements });

    return {
      score: ratioScore(verdicts),
      reason: summarizeVerdicts(verdicts),
      metadata: { statements, verdicts },
    };
  });
