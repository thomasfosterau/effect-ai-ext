/**
 * OpenAI `omni-moderation` as a provider-neutral `ModerationModel`
 * (`@thomasfosterau/effect-ai-ext`), routed through the Cloudflare AI
 * Gateway's universal endpoint. OpenAI has no `@effect/ai-*` package to
 * repoint, so — like `Cohere.ts` — this module is built directly on the two
 * gateway transports (`internal/transport.ts`): the Worker `AI` binding
 * ({@link makeOpenAiModerationModel}) and the config-resolved public HTTPS
 * endpoint ({@link makeOpenAiModerationModelFromUrl}) for callers with no
 * binding to ask.
 *
 * ## The key
 *
 * BYOK is the default: with the OpenAI key configured on the gateway itself
 * (Cloudflare dashboard, provider keys) no credential is sent from here. An
 * application that holds its own `OPENAI_API_KEY` — one whose gateway key
 * store does not carry OpenAI — passes it as `apiKey`, and it is sent as
 * the `Authorization: Bearer` header the gateway forwards to the provider.
 * `Redacted` so it never prints in a log or error message.
 *
 * ## What this module does NOT decide
 *
 * `ModerationModel` reports the provider's reading — `isFlagged` (the
 * provider's `flagged`), every category's score in `[0, 1]`, the provider's
 * own per-category verdicts (`flags`, from its `categories` booleans) and the
 * dated model snapshot that served the call (`modelId`, from its `model`). Turning scores into a hold / reject
 * decision, a priority band, or a review-queue item is threshold policy and
 * stays with the caller; this module reports, it does not sentence.
 *
 * ## Wire discipline
 *
 * The response schema is **lenient**: `categories` / `category_scores` are
 * free-form records (the provider adds categories over time), every field
 * the mapper does not need is optional, and a top-level field this module
 * has never heard of never fails an otherwise-valid response. The provider
 * sends `null` for a category it did not assess for an input; a null is
 * "not assessed", which must not grade as zero, so it is dropped rather
 * than coerced. `ModerationModel.make` validates the rest — exactly one
 * result per input, every score finite and within `[0, 1]` — and reports a
 * violation as `AiError.InvalidOutputError`.
 *
 * ## Inputs
 *
 * A batch of strings is one request (`input: string[]`), one result per
 * string. A multimodal input — an array of `effect/ai` text and file parts —
 * is screened by OpenAI as one combined input, so a batch that holds one is
 * sent as one request per input, in order: a text part becomes
 * `{ type: "text", text }` and an image file part becomes
 * `{ type: "image_url", image_url: { url } }`, its `data` sent as is when it
 * is already a URL or `data:` URI and as a base64 `data:` URI otherwise (a
 * private image never needs a public URL). A non-image file part fails with
 * `AiError.InvalidUserInputError` before any request is sent.
 *
 * ## The call ledger
 *
 * `onCall` observes every HTTP call once it settles — its status (`undefined`
 * when the transport failed before a response), its duration, and the
 * `AiError` it failed with, if it did — for a caller that records the cost and
 * latency of each call. The hook runs on failure too, before the `AiError`
 * reaches the caller.
 *
 * @module OpenAiModeration
 *
 * @copyright Thomas Foster
 */

import * as Arr from "effect/Array";
import type * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as EffectRecord from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { AiError, type Prompt } from "effect/ai";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ModerationModel } from "@thomasfosterau/effect-ai-ext";
import type { GatewayBinding, GatewayProvider } from "./Binding";
import { requestViaBinding, requestViaUrl, type GatewayCall } from "./internal/transport";
import * as Url from "./Url";

/** The AI Gateway provider slug for OpenAI (a {@link GatewayProvider}). */
const OPENAI_PROVIDER: GatewayProvider = "openai";

/** The gateway endpoint path for OpenAI's moderations API. */
const MODERATIONS_ENDPOINT = "moderations";

/** `AiError.module` / `method` for every failure this module reports. */
const ORIGIN = { module: "OpenAiModeration", method: "moderate" } as const;

/**
 * OpenAI's moderation model — the omni model classifies text and images
 * against one category vocabulary. A constant so a rotation is one edit.
 */
export const OPENAI_MODERATION_MODEL = "omni-moderation-latest";

/** Caller options shared by both transports. */
export interface OpenAiModerationOptions {
  /**
   * The application's own OpenAI key, sent as `Authorization: Bearer`.
   * Omit it when the key is configured on the gateway (BYOK).
   */
  readonly apiKey?: Redacted.Redacted<string> | undefined;
  /** The moderation model to request. Defaults to {@link OPENAI_MODERATION_MODEL}. */
  readonly model?: string | undefined;
  /**
   * Observes each HTTP call once it settles, success or failure, for a cost /
   * latency ledger. See {@link OpenAiModerationCall}.
   */
  readonly onCall?: ((call: OpenAiModerationCall) => Effect.Effect<void>) | undefined;
}

/**
 * One settled moderations call, as `onCall` sees it: the HTTP `status`
 * (`undefined` when the transport failed before a response), the
 * `durationMillis` from sending the request to decoding its response, and the
 * `error` it failed with (`undefined` on success).
 */
export type OpenAiModerationCall = GatewayCall;

/**
 * The provider's response, decoded leniently rather than trusted: a
 * gateway that answers 200 with an error envelope, or a model that changes
 * its response shape, must fail as an `AiError` rather than produce a
 * result with missing scores that grades as "nothing fired". Unknown fields
 * at any level are ignored. The wire field `flagged` decodes to `isFlagged`,
 * the name `ModerationModel` carries, here at the decode boundary.
 */
const OmniModerationResponse = Schema.Struct({
  model: Schema.optional(Schema.String),
  results: Schema.Array(
    Schema.Struct({
      isFlagged: Schema.Boolean,
      categories: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.Boolean))),
      category_scores: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.Finite))),
    }).pipe(Schema.encodeKeys({ isFlagged: "flagged" })),
  ),
});

/**
 * Drops the provider's `null` entries — "not assessed for this input" —
 * rather than coercing them to a score.
 */
const definedScores = (
  scores: Readonly<Record<string, number | null>> | undefined,
): Record<string, number> =>
  scores === undefined ? {} : EffectRecord.filter(scores, Predicate.isNotNull);

/** The provider's per-category verdicts, `null` ("not assessed") dropped. */
const definedFlags = (
  flags: Readonly<Record<string, boolean | null>> | undefined,
): Record<string, boolean> | undefined =>
  flags === undefined ? undefined : EffectRecord.filter(flags, Predicate.isNotNull);

/** One part of a multimodal moderations input, as OpenAI's wire carries it. */
type WireContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

/** The `input` field: a batch of strings, or one input's content parts. */
type WireInput = ReadonlyArray<string> | ReadonlyArray<WireContentPart>;

const invalidInput = (description: string): AiError.AiError =>
  AiError.make({
    module: ORIGIN.module,
    method: ORIGIN.method,
    reason: new AiError.InvalidUserInputError({ description }),
  });

/** An image file part's `data` as a URL OpenAI fetches or decodes itself. */
const imageUrl = (part: Prompt.FilePartEncoded): string => {
  const data = part.data;
  if (data instanceof URL) {
    return data.href;
  }
  if (Predicate.isString(data)) {
    return data.startsWith("data:") || data.startsWith("http")
      ? data
      : `data:${part.mediaType};base64,${data}`;
  }
  return `data:${part.mediaType};base64,${Base64.encode(data)}`;
};

const toWirePart = (
  part: Prompt.UserMessagePartEncoded,
): Effect.Effect<WireContentPart, AiError.AiError> => {
  if (part.type === "text") {
    return Effect.succeed({ type: "text", text: part.text });
  }
  return part.mediaType.startsWith("image/")
    ? Effect.succeed({ type: "image_url", image_url: { url: imageUrl(part) } })
    : Effect.fail(
        invalidInput(
          `OpenAI moderation screens text and images only; received a '${part.mediaType}' file part`,
        ),
      );
};

/**
 * The `input` of each request a batch needs: one batched request when every
 * input is a string, otherwise one request per input (OpenAI screens a
 * multimodal `input` as a single combined input). Every part is converted
 * before any request is sent, so an unsupported one fails the whole batch.
 */
const wireInputs = (
  inputs: ReadonlyArray<ModerationModel.ModerationInput>,
): Effect.Effect<ReadonlyArray<WireInput>, AiError.AiError> =>
  Arr.every(inputs, Predicate.isString)
    ? Effect.succeed([inputs])
    : Effect.forEach(
        inputs,
        (input) =>
          Predicate.isString(input)
            ? Effect.succeed<WireInput>([input])
            : Effect.forEach(input, toWirePart, { concurrency: 1 }),
        { concurrency: 1 },
      );

/** The moderations request body, identical on both transports. */
const moderationQuery = (options: OpenAiModerationOptions, input: WireInput) => ({
  model: options.model ?? OPENAI_MODERATION_MODEL,
  input,
});

/** The provider-facing headers: JSON, plus the caller's own key when it holds one. */
const moderationHeaders = (options: OpenAiModerationOptions) =>
  options.apiKey === undefined
    ? { "content-type": "application/json" }
    : {
        "content-type": "application/json",
        authorization: `Bearer ${Redacted.value(options.apiKey)}`,
      };

/**
 * Maps a decoded moderations response onto `ModerationModel`'s provider
 * contract. OpenAI's moderation endpoint reports no token usage.
 */
const mapModerationResponse = (
  responses: ReadonlyArray<typeof OmniModerationResponse.Type>,
): ModerationModel.ProviderResponse => ({
  results: Arr.flatMap(responses, (response) =>
    Arr.map(response.results, (result) => ({
      isFlagged: result.isFlagged,
      categories: definedScores(result.category_scores),
      flags: definedFlags(result.categories),
    })),
  ),
  usage: { inputTokens: undefined },
  modelId: Option.getOrUndefined(
    Arr.findFirst(responses, (response) => Option.fromUndefinedOr(response.model)),
  ),
});

/**
 * Sends each request a batch needs, in order, through one transport and maps
 * the responses onto `ModerationModel`'s provider contract.
 */
const moderateVia =
  (
    send: (input: WireInput) => Effect.Effect<typeof OmniModerationResponse.Type, AiError.AiError>,
  ) =>
  ({
    inputs,
  }: ModerationModel.ProviderOptions): Effect.Effect<
    ModerationModel.ProviderResponse,
    AiError.AiError
  > =>
    wireInputs(inputs).pipe(
      Effect.flatMap((requests) => Effect.forEach(requests, send, { concurrency: 1 })),
      Effect.map(mapModerationResponse),
    );

/**
 * Builds a `ModerationModel.Service` backed by OpenAI `omni-moderation-latest`
 * over the gateway's Worker-binding universal endpoint.
 */
export const makeOpenAiModerationModel = (
  binding: GatewayBinding,
  options: OpenAiModerationOptions = {},
): Effect.Effect<ModerationModel.Service> =>
  ModerationModel.make({
    moderate: moderateVia((input) =>
      requestViaBinding(
        ORIGIN,
        binding,
        {
          provider: OPENAI_PROVIDER,
          endpoint: MODERATIONS_ENDPOINT,
          headers: moderationHeaders(options),
          query: moderationQuery(options, input),
        },
        OmniModerationResponse,
        options.onCall,
      ),
    ),
  });

/**
 * Builds a `ModerationModel.Service` backed by OpenAI `omni-moderation-latest`
 * over the AI Gateway's **public HTTPS endpoint** — the binding-free sibling
 * of {@link makeOpenAiModerationModel}, usable from a plain Node process, a
 * local CLI, or CI.
 *
 * Config (`CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`, `CF_AIG_TOKEN`) is loaded
 * via `Url.gatewayUrlConfig` once at construction; a missing required value
 * fails with a typed `Config.ConfigError`. Provides `FetchHttpClient`
 * internally, so the returned effect carries no `HttpClient` (or Worker
 * binding) requirement.
 */
export const makeOpenAiModerationModelFromUrl = (
  options: OpenAiModerationOptions = {},
): Effect.Effect<ModerationModel.Service, Config.ConfigError> =>
  Effect.gen(function* () {
    const gatewayConfig = yield* Url.gatewayUrlConfig;
    const httpClient = yield* HttpClient.HttpClient;
    const url = `${Url.gatewayBaseUrl(gatewayConfig, OPENAI_PROVIDER)}/${MODERATIONS_ENDPOINT}`;
    const headers = {
      ...Url.cfAigAuthorizationHeader(gatewayConfig),
      ...moderationHeaders(options),
    };

    return yield* ModerationModel.make({
      moderate: moderateVia((input) =>
        requestViaUrl(
          ORIGIN,
          httpClient,
          url,
          headers,
          moderationQuery(options, input),
          OmniModerationResponse,
          options.onCall,
        ),
      ),
    });
  }).pipe(Effect.provide(FetchHttpClient.layer));
