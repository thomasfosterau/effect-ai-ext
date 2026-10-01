/**
 * @copyright Thomas Foster
 *
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
 * `ModerationModel` reports the provider's reading — `flagged`, and every
 * category's score in `[0, 1]`. Turning scores into a hold / reject
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
 * `ModerationModel` screens **text**. OpenAI's endpoint also accepts image
 * inputs, but the abstraction's contract is `inputs: ReadonlyArray<string>`,
 * so image moderation is outside this provider until the abstraction grows
 * a multimodal input.
 *
 * @module OpenAiModeration
 */

import type * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ModerationModel } from "@thomasfosterau/effect-ai-ext";
import type { GatewayBinding } from "./Binding";
import { requestViaBinding, requestViaUrl } from "./internal/transport";
import * as Url from "./Url";

/** The AI Gateway provider slug for OpenAI (`AIGatewayProviders["openai"]`). */
const OPENAI_PROVIDER: AIGatewayProviders = "openai";

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
}

/**
 * The provider's response, decoded leniently rather than trusted: a
 * gateway that answers 200 with an error envelope, or a model that changes
 * its response shape, must fail as an `AiError` rather than produce a
 * result with missing scores that grades as "nothing fired". Unknown fields
 * at any level are ignored.
 */
const OmniModerationResponse = Schema.Struct({
  model: Schema.optional(Schema.String),
  results: Schema.Array(
    Schema.Struct({
      flagged: Schema.Boolean,
      categories: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.Boolean))),
      category_scores: Schema.optional(
        Schema.Record(Schema.String, Schema.NullOr(Schema.Finite)),
      ),
    }),
  ),
});

/**
 * Drops the provider's `null` entries — "not assessed for this input" —
 * rather than coercing them to a score.
 */
const definedScores = (
  scores: Readonly<Record<string, number | null>> | undefined,
): Record<string, number> => {
  const out: Record<string, number> = {};
  if (scores === undefined) return out;
  for (const [category, score] of Object.entries(scores)) {
    if (score !== null) out[category] = score;
  }
  return out;
};

/** The moderations request body, identical on both transports. */
const moderationQuery = (options: OpenAiModerationOptions, inputs: ReadonlyArray<string>) => ({
  model: options.model ?? OPENAI_MODERATION_MODEL,
  input: inputs,
});

/** The provider-facing headers: JSON, plus the caller's own key when it holds one. */
const moderationHeaders = (options: OpenAiModerationOptions): Record<string, string> => ({
  "content-type": "application/json",
  ...(options.apiKey !== undefined && {
    authorization: `Bearer ${Redacted.value(options.apiKey)}`,
  }),
});

/**
 * Maps a decoded moderations response onto `ModerationModel`'s provider
 * contract. OpenAI's moderation endpoint reports no token usage.
 */
const mapModerationResponse = (
  response: typeof OmniModerationResponse.Type,
): ModerationModel.ProviderResponse => ({
  results: response.results.map((result) => ({
    flagged: result.flagged,
    categories: definedScores(result.category_scores),
  })),
  usage: { inputTokens: undefined },
});

/**
 * Builds a `ModerationModel.Service` backed by OpenAI `omni-moderation-latest`
 * over the gateway's Worker-binding universal endpoint.
 */
export const makeOpenAiModerationModel = (
  binding: GatewayBinding,
  options: OpenAiModerationOptions = {},
): Effect.Effect<ModerationModel.Service> =>
  ModerationModel.make({
    moderate: ({ inputs }) =>
      requestViaBinding(
        ORIGIN,
        binding,
        {
          provider: OPENAI_PROVIDER,
          endpoint: MODERATIONS_ENDPOINT,
          headers: moderationHeaders(options),
          query: moderationQuery(options, inputs),
        },
        OmniModerationResponse,
      ).pipe(Effect.map(mapModerationResponse)),
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
    const headers = { ...Url.cfAigAuthorizationHeader(gatewayConfig), ...moderationHeaders(options) };

    return yield* ModerationModel.make({
      moderate: ({ inputs }) =>
        requestViaUrl(
          ORIGIN,
          httpClient,
          url,
          headers,
          moderationQuery(options, inputs),
          OmniModerationResponse,
        ).pipe(Effect.map(mapModerationResponse)),
    });
  }).pipe(Effect.provide(FetchHttpClient.layer));
