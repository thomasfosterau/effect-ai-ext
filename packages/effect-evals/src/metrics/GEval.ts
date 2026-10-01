/**
 * `gEval` / `gEvalConversational` — an arbitrary-criteria LLM judge metric
 * (DeepEval's G-Eval): scores a case against a natural-language `criteria`
 * (the judge derives evaluation steps per run) or explicit `evaluationSteps`
 * (reproducible, no derivation call), optionally constrained by a `rubric` of
 * non-overlapping score bands. The judge is called once via
 * `LanguageModel.generateObject` with a `Schema.Struct` for score + reason
 * (+ derived steps, when `criteria` is used) — never string-parsed — and the
 * judge's `reason` flows straight into `Score.reason`. The judge
 * `LanguageModel` lives in `R`; judge failures surface as the typed
 * `AiError.AiError` rather than being thrown.
 *
 * `evaluationParams` (single-turn) / conversational equivalents select which
 * case fields the judge is shown; a field the caller asked for but the case
 * doesn't have (`undefined` or `null`) is a typed `MissingEvaluationParamError`,
 * not a throw — the case data itself is only known per-run, so this is
 * necessarily a runtime check rather than a construction-time one (contrast
 * the `criteria` XOR `evaluationSteps` and rubric-band-overlap checks below,
 * which validate a static metric definition and so fail immediately as thrown
 * errors — a metric wired up wrong is a programmer bug, not a case worth a
 * typed `E`).
 *
 * The request/response mechanics in the `judge` helper below — one
 * `generateObject` call, rubric-scale clamping and normalisation — are the
 * part expected to generalise to other structured-judge metrics (the RAG
 * suite, website#927); a metric with a materially different judge response
 * shape (e.g. per-chunk verdicts) will call `LanguageModel.generateObject` the
 * same way rather than reuse this exact function signature.
 *
 * @module metrics/GEval
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AiError, LanguageModel } from "effect/ai";
import * as Prompt from "effect/ai/Prompt";
import { makeMetric, type Metric } from "../Metric.ts";
import { makeScorer } from "../Scorer.ts";
import type { Score } from "../Score.ts";
import type { Threshold } from "../Threshold.ts";

// ── Errors ───────────────────────────────────────────────────────────

/**
 * A `gEval` metric asked to see a case field via `evaluationParams` that the
 * given case doesn't have (the underlying value was `undefined` or `null`) —
 * mirrors DeepEval's skip-on-missing-params behaviour, as a typed failure
 * rather than a throw or a silently-skipped field. Reused directly by
 * `metrics/rag/RagCase.ts` for the same failure mode against the RAG case
 * fields (`input`/`output`/`expected`/`retrievedContext`) — a case missing a
 * field a metric asked for is the same failure regardless of which judge
 * metric asked for it.
 */
export class MissingEvaluationParamError extends Schema.TaggedError<MissingEvaluationParamError>()(
  "MissingEvaluationParamError",
  {
    metric: Schema.String,
    param: Schema.String,
  },
) {}

/** The failure modes of a `gEval` / `gEvalConversational` scorer. */
export type GEvalError = MissingEvaluationParamError | AiError.AiError;

/** Whether a case field counts as absent for a `MissingEvaluationParamError` check. Exported for reuse by `metrics/rag/RagCase.ts`. */
export const isMissing = (value: unknown): boolean => value === undefined || value === null;

// ── Rubric ───────────────────────────────────────────────────────────

/** One score band in a {@link Rubric}, expressed on the rubric's `scaleMin..scaleMax` scale. */
export interface RubricBand {
  readonly min: number;
  readonly max: number;
  readonly description: string;
}

/**
 * Non-overlapping score bands constraining the judge's raw score, on
 * whatever scale the bands are authored on (DeepEval's convention is
 * `0..10`) — `scaleMin`/`scaleMax` are the lowest and highest band bounds.
 * `gEval` normalises the judge's raw score to `0..1` by clamping it into
 * `[scaleMin, scaleMax]` and rescaling.
 */
export interface Rubric {
  readonly scaleMin: number;
  readonly scaleMax: number;
  readonly bands: ReadonlyArray<RubricBand>;
}

/**
 * Builds a {@link Rubric} from its bands, sorted by `min`. Throws
 * immediately (a defect, not a typed error) when bands are missing, inverted
 * (`min > max`), or overlap — a malformed rubric is a mistake in the metric
 * definition itself, not a per-case runtime condition.
 */
export const makeRubric = (bands: ReadonlyArray<RubricBand>): Rubric => {
  if (bands.length === 0) {
    throw new Error("gEval rubric must have at least one band");
  }
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  for (const band of sorted) {
    if (band.min > band.max) {
      throw new Error(`gEval rubric band has min (${band.min}) greater than max (${band.max})`);
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (current.min <= previous.max) {
      throw new Error(
        `gEval rubric bands overlap: [${previous.min}, ${previous.max}] and [${current.min}, ${current.max}]`,
      );
    }
  }
  return { scaleMin: sorted[0]!.min, scaleMax: sorted[sorted.length - 1]!.max, bands: sorted };
};

// ── Prompt template ──────────────────────────────────────────────────

/** The inputs a {@link GEvalTemplate} renders into the judge's system/user messages. */
export interface GEvalTemplateParams {
  readonly name: string;
  readonly criteria?: string | undefined;
  readonly evaluationSteps?: ReadonlyArray<string> | undefined;
  readonly rubric?: Rubric | undefined;
  readonly fields: ReadonlyArray<{ readonly label: string; readonly value: string }>;
}

/** Overridable prompt wording for the G-Eval judge call. */
export interface GEvalTemplate {
  readonly system: (params: GEvalTemplateParams) => string;
  readonly user: (params: GEvalTemplateParams) => string;
}

const defaultSystem = (params: GEvalTemplateParams): string => {
  const lines: string[] = [`You are an expert evaluator scoring "${params.name}".`];

  if (params.evaluationSteps) {
    lines.push(
      "",
      "Apply these evaluation steps, in order:",
      ...params.evaluationSteps.map((step, index) => `${index + 1}. ${step}`),
    );
  } else if (params.criteria) {
    lines.push(
      "",
      `Evaluation criteria: ${params.criteria}`,
      "",
      "First derive a numbered list of concrete evaluation steps that operationalise this criteria, then apply them.",
    );
  }

  if (params.rubric) {
    lines.push(
      "",
      `Score on a scale of ${params.rubric.scaleMin} to ${params.rubric.scaleMax}, using these bands:`,
      ...params.rubric.bands.map((band) => `- ${band.min}-${band.max}: ${band.description}`),
    );
  } else {
    lines.push(
      "",
      "Score on a continuous scale of 0 to 1, where 1 is a perfect match to the criteria.",
    );
  }

  lines.push("", "Always provide a concise reason justifying the score.");
  return lines.join("\n");
};

const defaultUser = (params: GEvalTemplateParams): string =>
  params.fields.map((field) => `${field.label}:\n${field.value}`).join("\n\n");

/** The default {@link GEvalTemplate}. */
export const defaultTemplate: GEvalTemplate = { system: defaultSystem, user: defaultUser };

// ── Judge call (shared with structured-judge metrics, e.g. website#927) ──

const ScoreAndReason = Schema.Struct({
  score: Schema.Finite,
  reason: Schema.String,
});

const StepsScoreAndReason = Schema.Struct({
  steps: Schema.Array(Schema.String),
  score: Schema.Finite,
  reason: Schema.String,
});

interface JudgeParams {
  readonly name: string;
  readonly criteria?: string | undefined;
  readonly evaluationSteps?: ReadonlyArray<string> | undefined;
  readonly rubric?: Rubric | undefined;
  readonly fields: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly template: GEvalTemplate;
}

/**
 * Calls the judge `LanguageModel` once via `generateObject` and turns its
 * structured response into a {@link Score}: when `evaluationSteps` is given
 * the judge is asked only for `{ score, reason }` (the steps are already
 * known, recorded into metadata as-is); when `criteria` is given the judge
 * additionally returns the `steps` it derived, which are recorded instead.
 * The raw score is clamped into the rubric's `[scaleMin, scaleMax]` (or
 * `[0, 1]` with no rubric) and rescaled to `0..1`; a single-point rubric
 * (`scaleMin === scaleMax`) normalises to `1` since every valid judge score
 * on that rubric is, by construction, the only (and so the best) one.
 *
 * Exported for reuse by other structured-judge metrics (RAG suite,
 * website#927).
 */
export const judge = (
  params: JudgeParams,
): Effect.Effect<Score, AiError.AiError, LanguageModel.LanguageModel> =>
  Effect.gen(function* () {
    const model = yield* LanguageModel.LanguageModel;
    const templateParams: GEvalTemplateParams = {
      name: params.name,
      criteria: params.criteria,
      evaluationSteps: params.evaluationSteps,
      rubric: params.rubric,
      fields: params.fields,
    };
    const prompt: Prompt.RawInput = [
      { role: "system", content: params.template.system(templateParams) },
      { role: "user", content: params.template.user(templateParams) },
    ];

    let rawScore: number;
    let reason: string;
    let evaluationSteps: ReadonlyArray<string>;

    if (params.evaluationSteps) {
      const response = yield* model.generateObject({
        prompt,
        schema: ScoreAndReason,
        objectName: "evaluation",
      });
      rawScore = response.value.score;
      reason = response.value.reason;
      evaluationSteps = params.evaluationSteps;
    } else {
      const response = yield* model.generateObject({
        prompt,
        schema: StepsScoreAndReason,
        objectName: "evaluation",
      });
      rawScore = response.value.score;
      reason = response.value.reason;
      evaluationSteps = response.value.steps;
    }

    const scaleMin = params.rubric?.scaleMin ?? 0;
    const scaleMax = params.rubric?.scaleMax ?? 1;
    const clamped = Math.min(Math.max(rawScore, scaleMin), scaleMax);
    const normalized = scaleMax === scaleMin ? 1 : (clamped - scaleMin) / (scaleMax - scaleMin);

    return {
      score: normalized,
      reason,
      metadata: {
        evaluationSteps,
        ...(params.rubric ? { rubric: params.rubric } : {}),
      },
    };
  });

/**
 * Normalises `criteria` / `evaluationSteps` (an empty string or empty array
 * counts as not provided) and validates that exactly one of the two ends up
 * given. Throws (a defect) rather than returning a typed error — this is a
 * static mistake in the metric definition, not a per-case runtime condition.
 */
const resolveCriteria = (
  name: string,
  rawCriteria: string | undefined,
  rawEvaluationSteps: ReadonlyArray<string> | undefined,
): {
  readonly criteria: string | undefined;
  readonly evaluationSteps: ReadonlyArray<string> | undefined;
} => {
  const criteria = rawCriteria !== undefined && rawCriteria.length > 0 ? rawCriteria : undefined;
  const evaluationSteps =
    rawEvaluationSteps !== undefined && rawEvaluationSteps.length > 0
      ? rawEvaluationSteps
      : undefined;
  if ((criteria === undefined) === (evaluationSteps === undefined)) {
    throw new Error(
      `gEval "${name}": exactly one of "criteria" or "evaluationSteps" must be provided`,
    );
  }
  return { criteria, evaluationSteps };
};

/** Renders an arbitrary case field (which may not be a string) as text for a judge prompt. Exported for reuse by `metrics/rag/RagCase.ts`. */
export const renderValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("\n");
  }
  return JSON.stringify(value);
};

type Field = { readonly label: string; readonly value: string };

/** Extracts the fields named by `params` from a case, failing with the typed error on the first missing one. */
const collectFields = <Param extends string>(
  metricName: string,
  seed: ReadonlyArray<Field>,
  params: ReadonlyArray<Param>,
  extract: (param: Param) => unknown,
): Effect.Effect<ReadonlyArray<Field>, MissingEvaluationParamError> =>
  Effect.gen(function* () {
    const fields = [...seed];
    for (const param of params) {
      const value = extract(param);
      if (isMissing(value)) {
        return yield* new MissingEvaluationParamError({ metric: metricName, param });
      }
      fields.push({ label: param, value: renderValue(value) });
    }
    return fields;
  });

/** Options shared by {@link gEval} and {@link gEvalConversational}. */
interface GEvalSharedOptions {
  readonly name: string;
  readonly criteria?: string;
  readonly evaluationSteps?: ReadonlyArray<string>;
  readonly rubric?: Rubric;
  readonly threshold: Threshold;
  readonly template?: GEvalTemplate;
}

// ── Single-turn gEval ────────────────────────────────────────────────

/** Which fields of a single-turn case the judge is shown. */
export type EvaluationParam = "input" | "output" | "expected" | "context" | "retrievedContext";

/**
 * The structural shape `gEval` reads from — matches
 * `EvalCase.EvalCase(Golden.Golden(...), ...)`'s decoded type (which carries
 * additional fields `gEval` ignores).
 */
export interface GEvalCase {
  readonly golden: {
    readonly input: unknown;
    readonly expected?: unknown;
    readonly context?: ReadonlyArray<string> | undefined;
  };
  readonly output: unknown;
  readonly retrievedContext?: ReadonlyArray<string> | undefined;
}

const extractParam = (evalCase: GEvalCase, param: EvaluationParam): unknown => {
  switch (param) {
    case "input":
      return evalCase.golden.input;
    case "output":
      return evalCase.output;
    case "expected":
      return evalCase.golden.expected;
    case "context":
      return evalCase.golden.context;
    case "retrievedContext":
      return evalCase.retrievedContext;
  }
};

/** Options for {@link gEval}. */
export interface GEvalOptions extends GEvalSharedOptions {
  readonly evaluationParams: ReadonlyArray<EvaluationParam>;
}

/**
 * Builds a single-turn G-Eval {@link Metric}: an arbitrary-criteria LLM
 * judge over the fields of a case named by `evaluationParams`. See the
 * module docs for the `criteria` / `evaluationSteps` / rubric / error
 * semantics.
 */
export const gEval = <Case extends GEvalCase = GEvalCase>(
  options: GEvalOptions,
): Metric<Case, GEvalError, LanguageModel.LanguageModel> => {
  const { criteria, evaluationSteps } = resolveCriteria(
    options.name,
    options.criteria,
    options.evaluationSteps,
  );
  const template = options.template ?? defaultTemplate;

  const scorer = makeScorer<Case, GEvalError, LanguageModel.LanguageModel>({
    name: options.name,
    evaluate: (evalCase) =>
      Effect.gen(function* () {
        const fields = yield* collectFields(options.name, [], options.evaluationParams, (param) =>
          extractParam(evalCase, param),
        );
        return yield* judge({
          name: options.name,
          criteria,
          evaluationSteps,
          rubric: options.rubric,
          fields,
          template,
        });
      }),
  });

  return makeMetric({ name: options.name, scorer, threshold: options.threshold });
};

// ── Conversational gEval ─────────────────────────────────────────────

/** Which optional fields of a conversational case the judge is shown, beyond the turn history (always shown). */
export type ConversationalEvaluationParam = "scenario" | "expectedOutcome" | "context";

/**
 * The structural shape `gEvalConversational` reads from — matches
 * `Golden.ConversationalGolden(...)`'s decoded type. There is no separate
 * "actual output" for a conversational case: `turns` is already the realised
 * conversation being judged (DeepEval's `ConversationalTestCase`).
 */
export interface GEvalConversationalCase {
  readonly turns: Prompt.Prompt;
  readonly scenario?: string | undefined;
  readonly expectedOutcome?: unknown;
  readonly context?: ReadonlyArray<string> | undefined;
}

const renderMessageContent = (message: Prompt.Message): string => {
  if (message.role === "system") return message.content;
  return message.content.map((part) => ("text" in part ? part.text : `[${part.type}]`)).join(" ");
};

/** Renders a `Prompt`'s turn history into a transcript for the judge to read holistically. */
export const renderTurns = (turns: Prompt.Prompt): string =>
  turns.content.map((message) => `[${message.role}] ${renderMessageContent(message)}`).join("\n\n");

const extractConversationalParam = (
  evalCase: GEvalConversationalCase,
  param: ConversationalEvaluationParam,
): unknown => {
  switch (param) {
    case "scenario":
      return evalCase.scenario;
    case "expectedOutcome":
      return evalCase.expectedOutcome;
    case "context":
      return evalCase.context;
  }
};

/** Options for {@link gEvalConversational}. */
export interface GEvalConversationalOptions extends GEvalSharedOptions {
  readonly evaluationParams?: ReadonlyArray<ConversationalEvaluationParam>;
}

/**
 * Builds the conversational G-Eval {@link Metric}: the judge is shown the
 * full rendered turn history (DeepEval's `ConversationalGEval`) plus whatever
 * `evaluationParams` ask for, and scores the whole exchange holistically
 * against the criteria.
 */
export const gEvalConversational = <Case extends GEvalConversationalCase = GEvalConversationalCase>(
  options: GEvalConversationalOptions,
): Metric<Case, GEvalError, LanguageModel.LanguageModel> => {
  const { criteria, evaluationSteps } = resolveCriteria(
    options.name,
    options.criteria,
    options.evaluationSteps,
  );
  const template = options.template ?? defaultTemplate;
  const evaluationParams = options.evaluationParams ?? [];

  const scorer = makeScorer<Case, GEvalError, LanguageModel.LanguageModel>({
    name: options.name,
    evaluate: (evalCase) =>
      Effect.gen(function* () {
        const fields = yield* collectFields(
          options.name,
          [{ label: "conversation", value: renderTurns(evalCase.turns) }],
          evaluationParams,
          (param) => extractConversationalParam(evalCase, param),
        );
        return yield* judge({
          name: options.name,
          criteria,
          evaluationSteps,
          rubric: options.rubric,
          fields,
          template,
        });
      }),
  });

  return makeMetric({ name: options.name, scorer, threshold: options.threshold });
};
