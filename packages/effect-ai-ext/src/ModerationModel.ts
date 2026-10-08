/**
 * Defines the provider-neutral service for content moderation.
 *
 * A `ModerationModel` scores text against a set of policy categories and
 * reports whether each input is flagged — the sibling of `LanguageModel` and
 * `EmbeddingModel` from `effect/ai` (which has no moderation module
 * yet). Provider failures stay represented as `AiError` values.
 *
 * The shape mirrors `EmbeddingModel`: a provider supplies one `moderate`
 * function through {@link make}, provider results are validated (one result per
 * input, every category score finite and within `[0, 1]`), and
 * {@link fromLanguageModel} backs the service with any `LanguageModel` through
 * structured-output prompting.
 *
 * **Gotchas**
 *
 * - `moderate` with an empty `inputs` array returns an empty response without
 *   invoking the provider.
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AiError, LanguageModel } from "effect/ai";

/**
 * Service tag for moderation model operations.
 *
 * **When to use**
 *
 * Use to retrieve or provide the moderation model service for an `Effect`
 * program that screens content against policy categories.
 *
 * @see {@link Service} for the service contract provided by this tag
 * @see {@link make} for constructing a moderation model service from a provider
 * @see {@link fromLanguageModel} for backing the service with a `LanguageModel`
 *
 * @category services
 */
export class ModerationModel extends Context.Service<ModerationModel, Service>()(
  "@thomasfosterau/effect-ai-ext/ModerationModel",
) {}

/**
 * Represents token usage metadata for a moderation operation.
 *
 * **Details**
 *
 * `inputTokens` is `undefined` when the provider does not report usage or when
 * the empty input short-circuit bypassed the provider.
 *
 * @category models
 */
export class ModerationUsage extends Schema.Class<ModerationUsage>(
  "@thomasfosterau/effect-ai-ext/ModerationModel/ModerationUsage",
)({
  inputTokens: Schema.UndefinedOr(Schema.Finite),
}) {}

/**
 * Moderation result for a single input: whether it is flagged and its
 * per-category scores.
 *
 * **Details**
 *
 * `categories` maps a policy category name to a score in `[0, 1]`; higher means
 * more likely to violate that category.
 *
 * @category models
 */
export class ModerationResult extends Schema.Class<ModerationResult>(
  "@thomasfosterau/effect-ai-ext/ModerationModel/ModerationResult",
)({
  isFlagged: Schema.Boolean,
  categories: Schema.Record(Schema.String, Schema.Finite),
}) {}

/**
 * Response for a batch moderation request.
 *
 * **Details**
 *
 * `results` preserves input order, and `usage` carries token metadata for the
 * operation.
 *
 * @see {@link ModerationResult} for individual results
 * @see {@link ModerationUsage} for usage metadata
 *
 * @category models
 */
export class ModerationResponse extends Schema.Class<ModerationResponse>(
  "@thomasfosterau/effect-ai-ext/ModerationModel/ModerationResponse",
)({
  results: Schema.Array(ModerationResult),
  usage: ModerationUsage,
}) {}

/**
 * Caller-facing input options for a moderation request.
 *
 * @category options
 */
export interface ModerationOptions {
  /** The texts to screen. */
  readonly inputs: ReadonlyArray<string>;
}

/**
 * Provider input options for moderation requests.
 *
 * @category options
 */
export interface ProviderOptions {
  readonly inputs: ReadonlyArray<string>;
}

/**
 * Provider response contract consumed by {@link make}.
 *
 * @category models
 */
export interface ProviderResponse {
  readonly results: ReadonlyArray<{
    readonly isFlagged: boolean;
    readonly categories: Record<string, number>;
  }>;
  readonly usage: { readonly inputTokens: number | undefined };
}

/**
 * Defines the service interface for moderation operations.
 *
 * @category models
 */
export interface Service {
  readonly moderate: (
    options: ModerationOptions,
  ) => Effect.Effect<ModerationResponse, AiError.AiError>;
}

const invalidProviderResponse = (description: string): AiError.AiError =>
  AiError.make({
    module: "ModerationModel",
    method: "moderate",
    reason: new AiError.InvalidOutputError({ description }),
  });

const emptyResponse = (): ModerationResponse =>
  new ModerationResponse({
    results: [],
    usage: new ModerationUsage({ inputTokens: undefined }),
  });

const mapProviderResponse = (
  inputCount: number,
  response: ProviderResponse,
): Effect.Effect<ModerationResponse, AiError.AiError> => {
  if (response.results.length !== inputCount) {
    return Effect.fail(
      invalidProviderResponse(
        `Provider returned ${response.results.length} results but expected ${inputCount}`,
      ),
    );
  }
  const results: Array<ModerationResult> = [];
  for (const result of response.results) {
    for (const [category, score] of Object.entries(result.categories)) {
      if (!Number.isFinite(score) || score < 0 || score > 1) {
        return Effect.fail(
          invalidProviderResponse(
            `Provider returned score ${score} for category '${category}', expected a value between 0 and 1`,
          ),
        );
      }
    }
    results.push(
      new ModerationResult({ isFlagged: result.isFlagged, categories: result.categories }),
    );
  }
  return Effect.succeed(
    new ModerationResponse({
      results,
      usage: new ModerationUsage({ inputTokens: response.usage.inputTokens }),
    }),
  );
};

/**
 * Creates a `ModerationModel` service from a provider moderate implementation —
 * the analogue of `EmbeddingModel.make`.
 *
 * **Details**
 *
 * Provider responses are interpreted positionally and must contain exactly one
 * result for each requested input; every category score must be finite and
 * within `[0, 1]`. Violations fail with `AiError.InvalidOutputError`. `moderate`
 * with no inputs returns an empty response without calling the provider.
 *
 * @see {@link Service} for the service shape returned by this constructor
 * @see {@link ProviderOptions} for the input passed to the provider implementation
 * @see {@link ProviderResponse} for the provider response contract consumed by this constructor
 *
 * @category constructors
 */
export const make = (params: {
  readonly moderate: (options: ProviderOptions) => Effect.Effect<ProviderResponse, AiError.AiError>;
}): Effect.Effect<Service> =>
  Effect.sync(() =>
    ModerationModel.of({
      moderate: (options) =>
        (options.inputs.length === 0
          ? Effect.succeed(emptyResponse())
          : params
              .moderate({ inputs: options.inputs })
              .pipe(
                Effect.flatMap((response) => mapProviderResponse(options.inputs.length, response)),
              )
        ).pipe(Effect.withSpan("ModerationModel.moderate")),
    }),
  );

/**
 * The structured output a `LanguageModel` is asked for. The model sees the
 * field as `flagged` (the moderation APIs' own name, which the prompt below
 * uses); it decodes to `isFlagged`, the name {@link ModerationResult} carries.
 */
const StructuredModerationResult = Schema.Struct({
  isFlagged: Schema.Boolean,
  categories: Schema.Record(Schema.String, Schema.Finite),
}).pipe(Schema.encodeKeys({ isFlagged: "flagged" }));

const StructuredModerationOutput = Schema.Struct({
  results: Schema.Array(StructuredModerationResult),
});

const buildModeratePrompt = (options: ProviderOptions): string => {
  const lines: Array<string> = [
    "You are a strict content moderation system. Screen each input against common policy categories such as hate, harassment, self-harm, sexual, and violence.",
    "For each input return a `flagged` boolean and a `categories` map from category name to a score between 0 and 1 (higher means more likely to violate).",
    "Return one result per input, in the same order.",
    "Inputs:",
  ];
  options.inputs.forEach((input, index) => {
    lines.push(`${index + 1}. ${JSON.stringify(input)}`);
  });
  return lines.join("\n");
};

/**
 * Backs a {@link ModerationModel} with any `LanguageModel` through
 * structured-output prompting.
 *
 * **When to use**
 *
 * Use when a dedicated moderation endpoint is unavailable but a `LanguageModel`
 * is: the model is prompted to score each input across policy categories, and
 * its structured output flows through the same {@link make} validation path as
 * a native provider.
 *
 * **Details**
 *
 * The `LanguageModel` is drawn from context at construction time. Each
 * `moderate` call issues one `LanguageModel.generateObject` request whose schema
 * is the moderation contract; the decoded value is validated identically to a
 * native moderation provider.
 *
 * @see {@link make} for the validation path this adapter reuses
 *
 * @category constructors
 */
export const fromLanguageModel: Effect.Effect<Service, never, LanguageModel.LanguageModel> =
  LanguageModel.LanguageModel.pipe(
    Effect.flatMap((languageModel) =>
      make({
        moderate: (options) =>
          languageModel
            .generateObject({
              prompt: buildModeratePrompt(options),
              objectName: "moderation",
              schema: StructuredModerationOutput,
            })
            .pipe(
              Effect.map((response): ProviderResponse => ({
                results: response.value.results,
                usage: { inputTokens: undefined },
              })),
            ),
      }),
    ),
  );
