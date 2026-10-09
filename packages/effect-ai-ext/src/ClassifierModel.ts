/**
 * Defines the provider-neutral service for text classification.
 *
 * A `ClassifierModel` assigns one or more labels to each input text with a
 * confidence score — the sibling of `LanguageModel` and `EmbeddingModel` from
 * `effect/ai` (which has no classifier module yet). It supports
 * single- and multi-label classification, optional caller-supplied label sets,
 * and optional example-shot classification, and represents provider failures as
 * `AiError` values.
 *
 * The shape mirrors `EmbeddingModel`: a provider supplies one `classify`
 * function through {@link make}, provider results are validated (one
 * classification per input, finite scores, labels drawn from the caller's set
 * when one was given) and normalised to descending score order.
 * {@link fromLanguageModel} backs the service with any `LanguageModel` through
 * structured-output prompting.
 *
 * **Gotchas**
 *
 * - `classify` with an empty `inputs` array returns an empty response without
 *   invoking the provider.
 * - Each classification's `classes` are returned sorted by descending `score`
 *   regardless of provider ordering.
 */

import * as Order from "effect/Order";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AiError, LanguageModel } from "effect/ai";

/**
 * Service tag for classifier model operations.
 *
 * **When to use**
 *
 * Use to retrieve or provide the classifier model service for an `Effect`
 * program that assigns labels to text.
 *
 * @see {@link Service} for the service contract provided by this tag
 * @see {@link make} for constructing a classifier model service from a provider
 * @see {@link fromLanguageModel} for backing the service with a `LanguageModel`
 *
 * @category services
 */
export class ClassifierModel extends Context.Service<ClassifierModel, Service>()(
  "@thomasfosterau/effect-ai-ext/ClassifierModel",
) {}

/**
 * Represents token usage metadata for a classify operation.
 *
 * **Details**
 *
 * `inputTokens` is `undefined` when the provider does not report usage or when
 * the empty input short-circuit bypassed the provider.
 *
 * @category models
 */
export class ClassifierUsage extends Schema.Class<ClassifierUsage>(
  "@thomasfosterau/effect-ai-ext/ClassifierModel/ClassifierUsage",
)({
  inputTokens: Schema.UndefinedOr(Schema.Finite),
}) {}

/**
 * One candidate label with the confidence the model assigned to it.
 *
 * @category models
 */
export class ClassScore extends Schema.Class<ClassScore>(
  "@thomasfosterau/effect-ai-ext/ClassifierModel/ClassScore",
)({
  /** The candidate label. */
  label: Schema.String,
  /** Confidence that the input belongs to `label`; higher is more confident. */
  score: Schema.Finite,
}) {}

/**
 * Classification of a single input: its candidate classes sorted by descending
 * score.
 *
 * @see {@link ClassScore} for the individual label/score pairs
 *
 * @category models
 */
export class Classification extends Schema.Class<Classification>(
  "@thomasfosterau/effect-ai-ext/ClassifierModel/Classification",
)({
  classes: Schema.Array(ClassScore),
}) {}

/**
 * Response for a batch classify request containing per-input classifications
 * and usage metadata.
 *
 * **Details**
 *
 * `classifications` preserves input order, and `usage` carries token metadata
 * for the operation.
 *
 * @see {@link Classification} for individual classifications
 * @see {@link ClassifierUsage} for token usage metadata
 *
 * @category models
 */
export class ClassifyResponse extends Schema.Class<ClassifyResponse>(
  "@thomasfosterau/effect-ai-ext/ClassifierModel/ClassifyResponse",
)({
  classifications: Schema.Array(Classification),
  usage: ClassifierUsage,
}) {}

/**
 * A labelled example used for example-shot classification.
 *
 * @category options
 */
export interface ClassifyExample {
  readonly text: string;
  readonly label: string;
}

/**
 * Caller-facing input options for a classify request.
 *
 * @category options
 */
export interface ClassifyOptions {
  /** The texts to classify. */
  readonly inputs: ReadonlyArray<string>;
  /** Restrict classification to this label set (open-set when omitted). */
  readonly labels?: ReadonlyArray<string> | undefined;
  /** Allow more than one label per input when `true`. */
  readonly multiLabel?: boolean | undefined;
  /** Example-shot pairs guiding the classification. */
  readonly examples?: ReadonlyArray<ClassifyExample> | undefined;
}

/**
 * Provider input options for classify requests.
 *
 * @category options
 */
export interface ProviderOptions {
  readonly inputs: ReadonlyArray<string>;
  readonly labels: ReadonlyArray<string> | undefined;
  readonly multiLabel: boolean;
  readonly examples: ReadonlyArray<ClassifyExample> | undefined;
}

/**
 * Provider response contract consumed by {@link make}.
 *
 * @category models
 */
export interface ProviderResponse {
  readonly classifications: ReadonlyArray<{
    readonly classes: ReadonlyArray<{ readonly label: string; readonly score: number }>;
  }>;
  readonly usage: { readonly inputTokens: number | undefined };
}

/**
 * Defines the service interface for classifier operations.
 *
 * @category models
 */
export interface Service {
  readonly classify: (options: ClassifyOptions) => Effect.Effect<ClassifyResponse, AiError.AiError>;
}

const invalidProviderResponse = (description: string): AiError.AiError =>
  AiError.make({
    module: "ClassifierModel",
    method: "classify",
    reason: new AiError.InvalidOutputError({ description }),
  });

const emptyResponse = (): ClassifyResponse =>
  new ClassifyResponse({
    classifications: [],
    usage: new ClassifierUsage({ inputTokens: undefined }),
  });

/** Highest-scoring class first. */
const byScoreDescending: Order.Order<ClassScore> = Order.flip(
  Order.mapInput(Order.Number, (cls: ClassScore) => cls.score),
);

/**
 * Validates a provider response against the request it answered and normalises
 * each classification to descending score order.
 */
const mapProviderResponse = (
  inputCount: number,
  labels: ReadonlyArray<string> | undefined,
  response: ProviderResponse,
): Effect.Effect<ClassifyResponse, AiError.AiError> => {
  if (response.classifications.length !== inputCount) {
    return Effect.fail(
      invalidProviderResponse(
        `Provider returned ${response.classifications.length} classifications but expected ${inputCount}`,
      ),
    );
  }
  const allowed = labels === undefined ? undefined : new Set(labels);
  const classifications: Array<Classification> = [];
  for (const classification of response.classifications) {
    for (const cls of classification.classes) {
      if (!Number.isFinite(cls.score)) {
        return Effect.fail(
          invalidProviderResponse(
            `Provider returned a non-finite score ${cls.score} for label '${cls.label}'`,
          ),
        );
      }
      if (allowed !== undefined && !allowed.has(cls.label)) {
        return Effect.fail(
          invalidProviderResponse(
            `Provider returned label '${cls.label}' which is not in the requested label set`,
          ),
        );
      }
    }
    const classes = Arr.sort(
      classification.classes.map((cls) => new ClassScore({ label: cls.label, score: cls.score })),
      byScoreDescending,
    );
    classifications.push(new Classification({ classes }));
  }
  return Effect.succeed(
    new ClassifyResponse({
      classifications,
      usage: new ClassifierUsage({ inputTokens: response.usage.inputTokens }),
    }),
  );
};

/**
 * Creates a `ClassifierModel` service from a provider classify implementation —
 * the analogue of `EmbeddingModel.make`.
 *
 * **Details**
 *
 * Provider responses are interpreted positionally and must contain exactly one
 * classification for each requested input; every score must be finite, and when
 * the caller supplied `labels`, every returned label must belong to that set.
 * Violations fail with `AiError.InvalidOutputError`. `classify` with no inputs
 * returns an empty response without calling the provider.
 *
 * @see {@link Service} for the service shape returned by this constructor
 * @see {@link ProviderOptions} for the input passed to the provider implementation
 * @see {@link ProviderResponse} for the provider response contract consumed by this constructor
 *
 * @category constructors
 */
export const make = (params: {
  readonly classify: (options: ProviderOptions) => Effect.Effect<ProviderResponse, AiError.AiError>;
}): Effect.Effect<Service> =>
  Effect.sync(() =>
    ClassifierModel.of({
      classify: (options) =>
        (Arr.isReadonlyArrayEmpty(options.inputs)
          ? Effect.succeed(emptyResponse())
          : params
              .classify({
                inputs: options.inputs,
                labels: options.labels,
                multiLabel: options.multiLabel ?? false,
                examples: options.examples,
              })
              .pipe(
                Effect.flatMap((response) =>
                  mapProviderResponse(options.inputs.length, options.labels, response),
                ),
              )
        ).pipe(Effect.withSpan("ClassifierModel.classify")),
    }),
  );

const StructuredClassification = Schema.Struct({
  classes: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      score: Schema.Finite,
    }),
  ),
});

const StructuredClassifyResult = Schema.Struct({
  classifications: Schema.Array(StructuredClassification),
});

const buildClassifyPrompt = (options: ProviderOptions): string => {
  const lines: Array<string> = [
    "You are a precise text classifier. Classify each input text.",
    options.multiLabel
      ? "Each input may belong to more than one label."
      : "Assign the single best label to each input.",
  ];
  if (options.labels !== undefined) {
    lines.push(`Choose only from these labels: ${options.labels.join(", ")}.`);
  } else {
    lines.push("Choose concise, descriptive labels.");
  }
  if (options.examples !== undefined && Arr.isReadonlyArrayNonEmpty(options.examples)) {
    lines.push("Examples:");
    for (const example of options.examples) {
      lines.push(`- ${JSON.stringify(example.text)} => ${example.label}`);
    }
  }
  lines.push(
    "Return one classification per input, in the same order. Each classification lists candidate labels with a confidence score between 0 and 1.",
  );
  lines.push("Inputs:");
  options.inputs.forEach((input, index) => {
    lines.push(`${index + 1}. ${JSON.stringify(input)}`);
  });
  return lines.join("\n");
};

/**
 * Backs a {@link ClassifierModel} with any `LanguageModel` through
 * structured-output prompting.
 *
 * **When to use**
 *
 * Use when a dedicated classification endpoint is unavailable but a
 * `LanguageModel` is: the model is prompted to classify each input, and its
 * structured output flows through the same {@link make} validation path as a
 * native provider.
 *
 * **Details**
 *
 * The `LanguageModel` is drawn from context at construction time. Each
 * `classify` call issues one `LanguageModel.generateObject` request whose schema
 * is the classification contract; the decoded value is validated and normalised
 * identically to a native classifier.
 *
 * @see {@link make} for the validation path this adapter reuses
 *
 * @category constructors
 */
export const fromLanguageModel: Effect.Effect<Service, never, LanguageModel.LanguageModel> =
  LanguageModel.LanguageModel.pipe(
    Effect.flatMap((languageModel) =>
      make({
        classify: (options) =>
          languageModel
            .generateObject({
              prompt: buildClassifyPrompt(options),
              objectName: "classification",
              schema: StructuredClassifyResult,
            })
            .pipe(
              Effect.map((response): ProviderResponse => ({
                classifications: response.value.classifications,
                usage: { inputTokens: undefined },
              })),
            ),
      }),
    ),
  );
