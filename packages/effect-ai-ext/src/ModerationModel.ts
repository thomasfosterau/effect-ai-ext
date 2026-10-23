/**
 * Defines the provider-neutral service for content moderation.
 *
 * A `ModerationModel` scores content — text, or text and images — against a
 * set of policy categories and reports whether each input is flagged — the sibling of `LanguageModel` and
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
 * - An input is either a string or an array of `effect/ai` user-message parts
 *   (`Prompt.UserMessagePartEncoded`: `{ type: "text", text }` and
 *   `{ type: "file", mediaType, data }`), the same content a `LanguageModel`
 *   user message carries; a multimodal input yields one result, not one per
 *   part. A provider that cannot screen a part fails with
 *   `AiError.InvalidUserInputError`.
 */

import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as EffectRecord from "effect/Record";
import * as Schema from "effect/Schema";
import { AiError, LanguageModel, type Prompt } from "effect/ai";

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
 * Moderation result for a single input: whether it is flagged, its
 * per-category scores and, when the provider reports them, which categories
 * fired.
 *
 * **Details**
 *
 * `categories` maps a policy category name to a score in `[0, 1]`; higher means
 * more likely to violate that category. `flags` maps a category name to the
 * provider's own verdict for it; it is `undefined` when the provider publishes
 * scores only, since "fired" cannot be derived from a score without the
 * provider's threshold.
 *
 * @category models
 */
export class ModerationResult extends Schema.Class<ModerationResult>(
  "@thomasfosterau/effect-ai-ext/ModerationModel/ModerationResult",
)({
  isFlagged: Schema.Boolean,
  categories: Schema.Record(Schema.String, Schema.Finite),
  flags: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
}) {}

/**
 * Response for a batch moderation request.
 *
 * **Details**
 *
 * `results` preserves input order, and `usage` carries token metadata for the
 * operation. `modelId` is the model that served the call as the provider
 * reports it (for example a dated snapshot behind an alias), the name
 * `effect/ai`'s `Response.ResponseMetadataPart` uses; it is `undefined` when
 * the provider does not report one or the empty-input short-circuit bypassed
 * the provider.
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
  modelId: Schema.optional(Schema.String),
}) {}

/**
 * One piece of content to screen: a string, or an array of `effect/ai`
 * user-message parts (text and files) screened together as one input.
 *
 * **Details**
 *
 * The parts are `Prompt.UserMessagePartEncoded` values — the plain-object form
 * of a `LanguageModel` user message's content — so content already built for a
 * prompt can be screened as is. A file part's `data` is a URL, a `data:` URI, a
 * base64 string or raw bytes, with its `mediaType`. A multimodal input yields
 * one {@link ModerationResult}.
 *
 * @category models
 */
export type ModerationInput = string | ReadonlyArray<Prompt.UserMessagePartEncoded>;

/**
 * Caller-facing input options for a moderation request.
 *
 * @category options
 */
export interface ModerationOptions {
  /** The content to screen, one result per input. */
  readonly inputs: ReadonlyArray<ModerationInput>;
}

/**
 * Provider input options for moderation requests.
 *
 * @category options
 */
export interface ProviderOptions {
  /** The content to screen; never empty, and no input is an empty part list. */
  readonly inputs: ReadonlyArray<ModerationInput>;
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
    readonly flags?: Record<string, boolean> | undefined;
  }>;
  readonly usage: { readonly inputTokens: number | undefined };
  readonly modelId?: string | undefined;
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

const invalidUserInput = (description: string): AiError.AiError =>
  AiError.make({
    module: "ModerationModel",
    method: "moderate",
    reason: new AiError.InvalidUserInputError({ description }),
  });

const emptyResponse = (): ModerationResponse =>
  new ModerationResponse({
    results: [],
    usage: new ModerationUsage({ inputTokens: undefined }),
  });

const isEmptyPartList = (input: ModerationInput): boolean =>
  !Predicate.isString(input) && Arr.isReadonlyArrayEmpty(input);

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
  const outOfRange = Arr.findFirst(response.results, (result) =>
    Arr.findFirst(EffectRecord.toEntries(result.categories), ([category, score]) =>
      !Number.isFinite(score) || score < 0 || score > 1
        ? Option.some(
            `Provider returned score ${score} for category '${category}', expected a value between 0 and 1`,
          )
        : Option.none(),
    ),
  );
  if (Option.isSome(outOfRange)) {
    return Effect.fail(invalidProviderResponse(outOfRange.value));
  }
  const results = Arr.map(
    response.results,
    (result) =>
      new ModerationResult({
        isFlagged: result.isFlagged,
        categories: result.categories,
        flags: result.flags,
      }),
  );
  return Effect.succeed(
    new ModerationResponse({
      results,
      usage: new ModerationUsage({ inputTokens: response.usage.inputTokens }),
      modelId: response.modelId,
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
 * with no inputs returns an empty response without calling the provider; an
 * input that is an empty part list fails with `AiError.InvalidUserInputError`
 * before the provider is called. The provider's `flags` and `modelId` pass
 * through unchanged.
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
        (Arr.isReadonlyArrayEmpty(options.inputs)
          ? Effect.succeed(emptyResponse())
          : Arr.some(options.inputs, isEmptyPartList)
            ? Effect.fail(invalidUserInput("A moderation input must not be an empty part list"))
            : params
                .moderate({ inputs: options.inputs })
                .pipe(
                  Effect.flatMap((response) =>
                    mapProviderResponse(options.inputs.length, response),
                  ),
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

/** Quotes an input for the prompt exactly as `JSON.stringify` would. */
const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

const PROMPT_HEADER: ReadonlyArray<string> = [
  "You are a strict content moderation system. Screen each input against common policy categories such as hate, harassment, self-harm, sexual, and violence.",
  "For each input return a `flagged` boolean and a `categories` map from category name to a score between 0 and 1 (higher means more likely to violate).",
  "Return one result per input, in the same order.",
  "Inputs:",
];

const isTextInput = (input: ModerationInput): input is string => Predicate.isString(input);

/**
 * The prompt for a batch. A text-only batch is one string; a batch with a
 * multimodal input is one user message whose parts number each input and then
 * carry its content, so an image reaches the model as a file part.
 */
const buildModeratePrompt = (options: ProviderOptions): Prompt.RawInput => {
  if (Arr.every(options.inputs, isTextInput)) {
    return [
      ...PROMPT_HEADER,
      ...Arr.map(options.inputs, (input, index) => `${index + 1}. ${encodeJsonString(input)}`),
    ].join("\n");
  }
  const content: Array<Prompt.UserMessagePartEncoded> = [
    { type: "text", text: PROMPT_HEADER.join("\n") },
    ...Arr.flatMap(options.inputs, (input, index): Array<Prompt.UserMessagePartEncoded> =>
      isTextInput(input)
        ? [{ type: "text", text: `${index + 1}. ${encodeJsonString(input)}` }]
        : [{ type: "text", text: `${index + 1}.` }, ...input],
    ),
  ];
  return [{ role: "user", content }];
};

/** The model id a `LanguageModel` reported in its response metadata, if any. */
const responseModelId = (
  content: ReadonlyArray<{ readonly type: string; readonly modelId?: string | undefined }>,
): string | undefined =>
  Option.getOrUndefined(
    Arr.findFirst(content, (part) =>
      part.type === "response-metadata" ? Option.fromUndefinedOr(part.modelId) : Option.none(),
    ),
  );

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
 * native moderation provider. A multimodal input is sent as a user message's
 * parts, so the `LanguageModel` must accept the file types it carries. The
 * model's own verdicts are not asked for, so `flags` is `undefined`;
 * `modelId` is the one the `LanguageModel` reports in its response metadata.
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
                modelId: responseModelId(response.content),
              })),
            ),
      }),
    ),
  );
