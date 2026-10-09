/**
 * `CohereLanguageModel` — the Cohere implementation of Effect AI's
 * `LanguageModel` service over Command chat models. It translates Effect AI
 * prompts, tools, and structured-output requests into Cohere `/v2/chat`
 * requests (via {@link CohereClient}), then converts regular and streaming
 * Cohere responses back into Effect AI response parts.
 *
 * The public surface mirrors `MistralLanguageModel` /
 * `@effect/ai-anthropic`'s `AnthropicLanguageModel`: {@link model} for a
 * providable model descriptor, {@link layer} for a
 * `LanguageModel.LanguageModel` layer over {@link CohereClient}, {@link make}
 * for the service effect, and {@link withConfigOverride} for per-effect
 * request tuning. Nothing downstream of `LanguageModel.LanguageModel` needs to
 * know the provider is Cohere.
 *
 * Structured output uses Cohere's native `response_format` with a JSON schema
 * — the model returns the JSON as ordinary message content, which the
 * framework parses against the caller's schema. Tool-call parameters are
 * returned as parsed JSON; the framework validates them against the toolkit.
 *
 * Cohere v2 tool-choice cannot pin a single tool or express "auto" as a
 * value: `auto` omits `tool_choice`, `required` sends `REQUIRED`, `none`
 * sends `NONE`, and a specific-tool / `oneOf` directive is expressed by
 * filtering the `tools` array (plus `REQUIRED` when the mode demands a call).
 *
 * @module CohereLanguageModel
 *
 * @copyright Thomas Foster
 */

import * as Match from "effect/Match";
import * as Str from "effect/String";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import { dual } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";
import type * as AiError from "effect/ai/AiError";
import * as AiErrorNs from "effect/ai/AiError";
import * as IdGenerator from "effect/ai/IdGenerator";
import * as LanguageModel from "effect/ai/LanguageModel";
import * as AiModel from "effect/ai/Model";
import type * as Prompt from "effect/ai/Prompt";
import type * as Response from "effect/ai/Response";
import * as Tool from "effect/ai/Tool";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { CohereClient } from "./CohereClient";
import * as Errors from "./internal/errors";
import * as Wire from "./internal/wire";

const MODULE = "CohereLanguageModel";

/**
 * A selection of well-known Cohere Command chat model ids, offered for
 * autocomplete only — the constructors accept any string.
 */
export type Model =
  | "command-a-03-2025"
  | "command-a-vision-07-2025"
  | "command-r-plus"
  | "command-r-plus-08-2024"
  | "command-r"
  | "command-r-08-2024"
  | "command-r7b-12-2024"
  | "command-nightly";

// =============================================================================
// Configuration
// =============================================================================

/**
 * The tunable request fields merged into every Cohere request. Values set on
 * the {@link Config} context service override those supplied to {@link make},
 * {@link layer}, or {@link model}.
 */
export interface ConfigService {
  readonly model?: string | undefined;
  readonly temperature?: number | undefined;
  /** Nucleus sampling probability (Cohere's `p`, i.e. OpenAI's `top_p`). */
  readonly topP?: number | undefined;
  /** Top-k sampling (Cohere's `k`). */
  readonly topK?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly seed?: number | undefined;
  readonly stopSequences?: ReadonlyArray<string> | undefined;
  readonly presencePenalty?: number | undefined;
  readonly frequencyPenalty?: number | undefined;
}

/**
 * Context service carrying Cohere request defaults / per-operation overrides.
 * Provide it (or use {@link withConfigOverride}) to tune generation without
 * changing the model's construction-time config.
 */
export class Config extends Context.Service<Config, ConfigService>()(
  "@thomasfosterau/effect-ai-cohere/CohereLanguageModel/Config",
) {}

// =============================================================================
// Language Model
// =============================================================================

/**
 * Creates a Cohere model descriptor that can be provided with
 * `Effect.provide`, carrying provider and model metadata.
 *
 * @see {@link layer} for a `LanguageModel.LanguageModel` layer
 * @see {@link make} for the service effect
 */
export const model = (
  model: (string & Record<never, never>) | Model,
  config?: Omit<ConfigService, "model">,
): AiModel.Model<"cohere", LanguageModel.LanguageModel, CohereClient> =>
  AiModel.make("cohere", model, layer({ model, config }));

/**
 * Constructs a `LanguageModel` service backed by {@link CohereClient}.
 * Request defaults from `config` are merged with any {@link Config} service in
 * context, the context values winning.
 *
 * @see {@link layer} for providing the service as a `Layer`
 * @see {@link model} for a providable model descriptor
 */
export const make = Effect.fnUntraced(function* ({
  model,
  config: providerConfig,
}: {
  readonly model: (string & Record<never, never>) | Model;
  readonly config?: Omit<ConfigService, "model"> | undefined;
}): Effect.fn.Return<LanguageModel.LanguageModel, never, CohereClient> {
  const client = yield* CohereClient;

  const makeConfig: Effect.Effect<ConfigService & { readonly model: string }> = Effect.gen(
    function* () {
      const services = yield* Effect.context<never>();
      return { model, ...providerConfig, ...services.mapUnsafe.get(Config.key) };
    },
  );

  const buildRequest = (
    config: ConfigService & { readonly model: string },
    options: LanguageModel.ProviderOptions,
    stream: boolean,
  ): Effect.Effect<Wire.ChatRequest, AiError.AiError> =>
    Effect.gen(function* () {
      const messages = yield* prepareMessages(options.prompt);
      const { tools, toolChoice } = yield* prepareTools(options);
      const responseFormat = yield* prepareResponseFormat(options);
      // Assemble every field (undefined for those unset) and drop the
      // undefined keys in one pass, rather than branching per field.
      // SAFETY: `compact` removes every `undefined` field, so each optional
      // `ChatRequest` field is either absent or set, as the wire type requires.
      return compact({
        model: config.model,
        messages,
        stream,
        temperature: config.temperature,
        p: config.topP,
        k: config.topK,
        max_tokens: config.maxTokens,
        seed: config.seed,
        stop_sequences: config.stopSequences,
        presence_penalty: config.presencePenalty,
        frequency_penalty: config.frequencyPenalty,
        tools,
        tool_choice: toolChoice,
        response_format: responseFormat,
      }) as Wire.ChatRequest;
    });

  return yield* LanguageModel.make({
    generateText: Effect.fnUntraced(function* (options) {
      const config = yield* makeConfig;
      const request = yield* buildRequest(config, options, false);
      const [body, response] = yield* client.chat(request);
      return yield* makeResponse(config.model, body, response);
    }),
    streamText: (options) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const idGen = yield* IdGenerator.IdGenerator;
          const textId = yield* idGen.generateId();
          const now = yield* DateTime.now;
          const timestamp = DateTime.formatIso(now);
          const config = yield* makeConfig;
          const request = yield* buildRequest(config, options, true);
          const [response, events] = yield* client.chatStream(request);
          const context: StreamContext = {
            modelId: config.model,
            textId,
            timestamp,
            request: buildRequestDetails(response.request),
            response: buildResponseDetails(response),
          };
          const state: StreamState = {
            metadataEmitted: false,
            textStarted: false,
            textEnded: false,
            finished: false,
            tools: new Map(),
            toolOrder: [],
          };
          return events.pipe(
            Stream.flatMap((event) => Stream.fromArray(handleEvent(event, state, context))),
          );
        }),
      ),
  });
});

/**
 * Provides {@link CohereLanguageModel} as a `LanguageModel.LanguageModel`
 * layer, drawing {@link CohereClient} from another layer.
 */
export const layer = (options: {
  readonly model: (string & Record<never, never>) | Model;
  readonly config?: Omit<ConfigService, "model"> | undefined;
}): Layer.Layer<LanguageModel.LanguageModel, never, CohereClient> =>
  Layer.effect(LanguageModel.LanguageModel, make(options));

/**
 * Applies Cohere request overrides to one effect without changing the model's
 * default config. Overrides merge over any existing {@link Config} service and
 * win. Supports both data-first and data-last invocation.
 */
export const withConfigOverride: {
  (
    overrides: ConfigService,
  ): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Config>>;
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    overrides: ConfigService,
  ): Effect.Effect<A, E, Exclude<R, Config>>;
} = dual(2, <A, E, R>(self: Effect.Effect<A, E, R>, overrides: ConfigService) =>
  Effect.flatMap(Effect.serviceOption(Config), (config) =>
    Effect.provideService(self, Config, {
      ...Option.getOrUndefined(config),
      ...overrides,
    }),
  ),
);

// =============================================================================
// Prompt Conversion
// =============================================================================

const failure = (method: string, reason: AiError.AiErrorReason): AiError.AiError =>
  AiErrorNs.make({ module: MODULE, method, reason });

/** Drops keys whose value is `undefined`, preserving the object's type. */
const compact = <T extends Record<string, unknown>>(record: T): T =>
  // SAFETY: only keys whose value is `undefined` are dropped; every other key
  // keeps the value, and so the type, it had in `record`.
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

const normalizeImageMediaType = (mediaType: string): string =>
  mediaType === "image/*" ? "image/jpeg" : mediaType;

const fileToImageUrl = (part: Prompt.FilePart): string => {
  const data = part.data;
  if (data instanceof URL) {
    return data.href;
  }
  if (Predicate.isString(data)) {
    return data.startsWith("data:") || data.startsWith("http")
      ? data
      : `data:${normalizeImageMediaType(part.mediaType)};base64,${data}`;
  }
  return `data:${normalizeImageMediaType(part.mediaType)};base64,${Base64.encode(data)}`;
};

/**
 * Converts a `user` message, mapping text parts through and image files to
 * `image_url` blocks. A text-only message collapses to a plain string. A
 * non-image file part is rejected — Cohere chat accepts images only (on
 * vision-capable Command models).
 */
/** One user content part as a request part: text, or an image (the only file type Cohere accepts). */
const convertUserPart = (
  part: Prompt.UserMessage["content"][number],
): Effect.Effect<Wire.RequestContentPart, AiError.AiError> => {
  if (part.type === "text") {
    return Effect.succeed({ type: "text", text: part.text });
  }
  if (!part.mediaType.startsWith("image/")) {
    return Effect.fail(
      failure(
        "prepareMessages",
        new AiErrorNs.InvalidUserInputError({
          description: `Cohere chat supports image files only; received '${part.mediaType}'`,
        }),
      ),
    );
  }
  return Effect.succeed({ type: "image_url", image_url: { url: fileToImageUrl(part) } });
};

const convertUserMessage = (
  message: Prompt.UserMessage,
): Effect.Effect<Wire.UserMessageRequest, AiError.AiError> =>
  Effect.forEach(message.content, (part) => convertUserPart(part), { concurrency: 1 }).pipe(
    Effect.map((parts): Wire.UserMessageRequest => ({
      role: "user",
      content: Arr.some(parts, (part) => part.type !== "text")
        ? parts
        : parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
    })),
  );

/**
 * Converts an `assistant` message: text parts concatenate into `content`
 * (omitted when empty), and framework-executed tool calls become
 * `tool_calls`. Reasoning / file / tool-result / approval parts have no
 * Cohere representation and are dropped.
 */
const convertAssistantMessage = (
  message: Prompt.AssistantMessage,
): Wire.AssistantMessageRequest => {
  let text = "";
  const toolCalls: Array<Wire.RequestToolCall> = [];
  for (const part of message.content) {
    if (part.type === "text") {
      text += part.text;
    } else if (part.type === "tool-call" && !part.providerExecuted) {
      toolCalls.push({
        id: part.id,
        type: "function",
        function: { name: part.name, arguments: JSON.stringify(part.params) },
      });
    }
  }
  return {
    role: "assistant",
    content: Str.isNonEmpty(text) ? text : null,
    ...(Arr.isReadonlyArrayNonEmpty(toolCalls) ? { tool_calls: toolCalls } : undefined),
  };
};

/** Converts a `tool` message into one Cohere `tool` message per result. */
const convertToolMessage = (message: Prompt.ToolMessage): Array<Wire.ToolMessageRequest> => {
  const messages: Array<Wire.ToolMessageRequest> = [];
  for (const part of message.content) {
    if (part.type !== "tool-result") {
      continue;
    }
    messages.push({
      role: "tool",
      tool_call_id: part.id,
      content: Predicate.isString(part.result) ? part.result : JSON.stringify(part.result),
    });
  }
  return messages;
};

/**
 * Converts an Effect AI prompt into the flat Cohere messages array. Each
 * Effect AI message maps to one Cohere message, except a `tool` message, whose
 * results each become their own Cohere `tool` message.
 */
/** One Effect AI message as the request messages it becomes (a `tool` message may become several). */
const convertMessage = (
  message: Prompt.Message,
): Effect.Effect<ReadonlyArray<Wire.MessageRequest>, AiError.AiError> =>
  Match.value(message).pipe(
    Match.discriminatorsExhaustive("role")({
      system: (system) =>
        Effect.succeed<ReadonlyArray<Wire.MessageRequest>>([
          { role: "system", content: system.content },
        ]),
      user: (user) =>
        Effect.map(convertUserMessage(user), (request): ReadonlyArray<Wire.MessageRequest> => [
          request,
        ]),
      assistant: (assistant) =>
        Effect.succeed<ReadonlyArray<Wire.MessageRequest>>([convertAssistantMessage(assistant)]),
      tool: (tool) => Effect.succeed<ReadonlyArray<Wire.MessageRequest>>(convertToolMessage(tool)),
    }),
  );

const prepareMessages = (
  prompt: Prompt.Prompt,
): Effect.Effect<ReadonlyArray<Wire.MessageRequest>, AiError.AiError> =>
  Effect.forEach(prompt.content, (message) => convertMessage(message), { concurrency: 1 }).pipe(
    Effect.map(Arr.flatten),
  );

// =============================================================================
// Tool Conversion
// =============================================================================

const tryToolJsonSchema = (
  tool: Tool.Any,
  method: string,
): Effect.Effect<unknown, AiError.AiError> =>
  Effect.try({
    try: () => Tool.getJsonSchema(tool),
    catch: (error) =>
      failure(
        method,
        new AiErrorNs.UnsupportedSchemaError({
          description: error instanceof Error ? error.message : String(error),
        }),
      ),
  });

/** Converts one Effect AI tool into a Cohere function-tool definition. */
const buildToolRequest = (tool: Tool.Any): Effect.Effect<Wire.ToolRequest, AiError.AiError> =>
  Effect.gen(function* () {
    const name = tool.name;
    if (!Tool.isUserDefined(tool) && !Tool.isDynamic(tool)) {
      return yield* failure(
        "prepareTools",
        new AiErrorNs.InvalidUserInputError({
          description: `Cohere supports user-defined function tools only; received provider-defined tool '${name}'`,
        }),
      );
    }
    const parameters = yield* tryToolJsonSchema(tool, "prepareTools");
    const description = Tool.getDescription(tool);
    return {
      type: "function",
      function: {
        name,
        parameters,
        ...(Predicate.isNotUndefined(description) ? { description } : undefined),
      },
    };
  });

/** The tool set and tool-choice directive a request is sent with. */
interface ResolvedToolChoice {
  readonly tools: ReadonlyArray<Wire.ToolRequest>;
  readonly toolChoice: Wire.ToolChoiceRequest | undefined;
}

/**
 * Maps Effect AI's tool-choice directive onto Cohere's, filtering the tool set
 * for a specific-tool or `oneOf` subset. Cohere expresses only `REQUIRED` /
 * `NONE` / (omitted = auto), so a pinned tool is enforced by narrowing the
 * `tools` array to that tool and requiring a call.
 */
const resolveToolChoice = (
  toolChoice: LanguageModel.ProviderOptions["toolChoice"],
  tools: ReadonlyArray<Wire.ToolRequest>,
): ResolvedToolChoice => {
  if (toolChoice === "auto") {
    return { tools, toolChoice: undefined };
  }
  if (toolChoice === "none") {
    return { tools, toolChoice: "NONE" };
  }
  if (toolChoice === "required") {
    return { tools, toolChoice: "REQUIRED" };
  }
  if ("tool" in toolChoice) {
    return {
      tools: tools.filter((tool) => tool.function.name === toolChoice.tool),
      toolChoice: "REQUIRED",
    };
  }
  const allowed = new Set(toolChoice.oneOf);
  return {
    tools: tools.filter((tool) => allowed.has(tool.function.name)),
    toolChoice: toolChoice.mode === "required" ? "REQUIRED" : undefined,
  };
};

const prepareTools = (
  options: LanguageModel.ProviderOptions,
): Effect.Effect<
  {
    readonly tools: ReadonlyArray<Wire.ToolRequest> | undefined;
    readonly toolChoice: Wire.ToolChoiceRequest | undefined;
  },
  AiError.AiError
> =>
  Effect.gen(function* () {
    if (Arr.isReadonlyArrayEmpty(options.tools) || options.toolChoice === "none") {
      return { tools: undefined, toolChoice: undefined };
    }
    const tools = yield* Effect.forEach(options.tools, (tool) => buildToolRequest(tool), {
      concurrency: 1,
    });
    return resolveToolChoice(options.toolChoice, tools);
  });

// =============================================================================
// Response Format (structured output)
// =============================================================================

const prepareResponseFormat = (
  options: LanguageModel.ProviderOptions,
): Effect.Effect<Wire.ResponseFormatRequest | undefined, AiError.AiError> =>
  Effect.gen(function* () {
    const responseFormat = options.responseFormat;
    if (responseFormat.type !== "json") {
      return undefined;
    }
    const schema = yield* Effect.try({
      try: () => Tool.getJsonSchemaFromSchema(responseFormat.schema),
      catch: (error) =>
        failure(
          "prepareResponseFormat",
          new AiErrorNs.UnsupportedSchemaError({
            description: error instanceof Error ? error.message : String(error),
          }),
        ),
    });
    return { type: "json_object", schema };
  });

// =============================================================================
// Shared Response Helpers
// =============================================================================

/**
 * Narrows a Cohere finish reason to Effect AI's, case-insensitively — Cohere
 * reports uppercase values (`COMPLETE`, `MAX_TOKENS`, `TOOL_CALL`, …) but has
 * used lowercase (`tool_calls`) in places, so both are accepted.
 */
const mapFinishReason = (reason: string | null | undefined): Response.FinishReason => {
  if (Predicate.isNullish(reason)) {
    return "unknown";
  }
  return Match.value(reason.toLowerCase()).pipe(
    Match.when(Match.is("complete", "stop", "stop_sequence"), (): Response.FinishReason => "stop"),
    Match.when(Match.is("max_tokens", "length"), (): Response.FinishReason => "length"),
    Match.when(Match.is("tool_call", "tool_calls"), (): Response.FinishReason => "tool-calls"),
    Match.when(
      Match.is("error_toxic", "content_filter"),
      (): Response.FinishReason => "content-filter",
    ),
    Match.when(Match.is("error", "error_limit"), (): Response.FinishReason => "error"),
    Match.orElse((): Response.FinishReason => "other"),
  );
};

/** The shared usage envelope Cohere reports under either `usage` or `meta`. */
type UsageEnvelope = Wire.ChatResponse["usage"];

const makeUsage = (usage: UsageEnvelope, meta: UsageEnvelope): typeof Response.Usage.Encoded => {
  const tokens = usage?.tokens ?? meta?.tokens ?? undefined;
  return {
    inputTokens: {
      uncached: undefined,
      total: tokens?.input_tokens ?? undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: tokens?.output_tokens ?? undefined,
      text: undefined,
      reasoning: undefined,
    },
  };
};

const buildRequestDetails = (
  request: HttpClientRequest.HttpClientRequest,
): typeof Response.HttpRequestDetails.Encoded => ({
  method: request.method,
  url: request.url,
  urlParams: Array.from(request.urlParams),
  hash: request.hash._tag === "Some" ? request.hash.value : undefined,
  headers: Errors.redactHeaders(request.headers),
});

const buildResponseDetails = (
  response: HttpClientResponse.HttpClientResponse,
): typeof Response.HttpResponseDetails.Encoded => ({
  status: response.status,
  headers: Errors.redactHeaders(response.headers),
});

// =============================================================================
// Non-streaming Response Conversion
// =============================================================================

const collectText = (content: Wire.ChatResponse["message"]["content"]): string => {
  if (Predicate.isNullish(content)) {
    return "";
  }
  let text = "";
  for (const part of content) {
    if ((part.type === undefined || part.type === "text") && Predicate.isNotNullish(part.text)) {
      text += part.text;
    }
  }
  return text;
};

const makeResponse = (
  modelId: string,
  body: Wire.ChatResponse,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<Array<Response.PartEncoded>, AiError.AiError, IdGenerator.IdGenerator> =>
  Effect.gen(function* () {
    const parts: Array<Response.PartEncoded> = [];
    const now = yield* DateTime.now;
    const responseDetails = buildResponseDetails(response);

    parts.push({
      type: "response-metadata",
      id: body.id,
      modelId,
      timestamp: DateTime.formatIso(now),
      request: buildRequestDetails(response.request),
    });

    const text = collectText(body.message.content);
    if (Str.isNonEmpty(text)) {
      parts.push({ type: "text", text });
    }

    const toolCalls = body.message.tool_calls;
    if (Predicate.isNotNullish(toolCalls)) {
      const toolCallParts = yield* Effect.forEach(
        toolCalls,
        (toolCall) =>
          Effect.map(
            Predicate.isNotNullish(toolCall.id) ? Effect.succeed(toolCall.id) : generateId(),
            (id): Response.PartEncoded => ({
              type: "tool-call",
              id,
              name: toolCall.function.name,
              params: Wire.parseJsonLenient(toolCall.function.arguments ?? "{}"),
              providerExecuted: false,
            }),
          ),
        { concurrency: 1 },
      );
      parts.push(...toolCallParts);
    }

    parts.push({
      type: "finish",
      reason: mapFinishReason(body.finish_reason),
      usage: makeUsage(body.usage, body.meta),
      response: responseDetails,
    });

    return parts;
  });

const generateId = (): Effect.Effect<string, never, IdGenerator.IdGenerator> =>
  Effect.flatMap(IdGenerator.IdGenerator, (idGen) => idGen.generateId());

// =============================================================================
// Streaming Response Conversion
// =============================================================================

/** Per-stream immutable context: the synthesised text id and metadata. */
interface StreamContext {
  readonly modelId: string;
  readonly textId: string;
  readonly timestamp: string;
  readonly request: typeof Response.HttpRequestDetails.Encoded;
  readonly response: typeof Response.HttpResponseDetails.Encoded;
}

/** Accumulated state for one streamed tool call, keyed by its event index. */
interface ToolAccumulator {
  id: string;
  name: string;
  started: boolean;
  args: string;
}

/** Mutable per-stream state threaded across events. */
interface StreamState {
  metadataEmitted: boolean;
  textStarted: boolean;
  textEnded: boolean;
  finished: boolean;
  readonly tools: Map<number, ToolAccumulator>;
  readonly toolOrder: Array<number>;
}

/** Normalises Cohere's `tool_calls` delta (object or one-element array) to a single fragment. */
const firstToolCall = (
  toolCalls: NonNullable<
    NonNullable<NonNullable<Wire.ChatStreamEvent["delta"]>["message"]>["tool_calls"]
  >,
): Wire.StreamToolCall =>
  // SAFETY: `tool_calls` is one fragment or an array of them, and
  // `Array.isArray` does not narrow a readonly array out of the union.
  Array.isArray(toolCalls) ? toolCalls[0] : (toolCalls as Wire.StreamToolCall);

const emitResponseMetadata = (
  event: Wire.ChatStreamEvent,
  state: StreamState,
  context: StreamContext,
  out: Array<Response.StreamPartEncoded>,
): void => {
  if (state.metadataEmitted) {
    return;
  }
  state.metadataEmitted = true;
  out.push({
    type: "response-metadata",
    id: event.id,
    modelId: context.modelId,
    timestamp: context.timestamp,
    request: context.request,
  });
};

const handleTextDelta = (
  text: string | null | undefined,
  state: StreamState,
  context: StreamContext,
  out: Array<Response.StreamPartEncoded>,
): void => {
  if (!state.textStarted) {
    state.textStarted = true;
    out.push({ type: "text-start", id: context.textId });
  }
  if (Predicate.isNotNullish(text) && Str.isNonEmpty(text)) {
    out.push({ type: "text-delta", id: context.textId, delta: text });
  }
};

const getOrCreateToolAccumulator = (
  toolCall: Wire.StreamToolCall,
  index: number,
  state: StreamState,
  context: StreamContext,
): ToolAccumulator => {
  const existing = state.tools.get(index);
  if (Predicate.isNotUndefined(existing)) {
    const name = toolCall.function?.name;
    if (Str.isEmpty(existing.name) && Predicate.isNotUndefined(name) && name !== null) {
      existing.name = name;
    }
    return existing;
  }
  const created: ToolAccumulator = {
    id: toolCall.id ?? `${context.textId}-tool-${index}`,
    name: toolCall.function?.name ?? "",
    started: false,
    args: "",
  };
  state.tools.set(index, created);
  state.toolOrder.push(index);
  return created;
};

const handleToolCallDelta = (
  event: Wire.ChatStreamEvent,
  state: StreamState,
  context: StreamContext,
  out: Array<Response.StreamPartEncoded>,
): void => {
  const toolCalls = event.delta?.message?.tool_calls;
  if (Predicate.isNullish(toolCalls)) {
    return;
  }
  const toolCall = firstToolCall(toolCalls);
  const index = event.index ?? 0;
  const accumulator = getOrCreateToolAccumulator(toolCall, index, state, context);

  if (!accumulator.started) {
    accumulator.started = true;
    out.push({ type: "tool-params-start", id: accumulator.id, name: accumulator.name });
  }

  const argsFragment = toolCall.function?.arguments;
  if (Predicate.isNotNullish(argsFragment) && Str.isNonEmpty(argsFragment)) {
    accumulator.args += argsFragment;
    out.push({ type: "tool-params-delta", id: accumulator.id, delta: argsFragment });
  }
};

/**
 * Converts one Cohere streaming event into zero or more Effect AI stream
 * parts, mutating `state` so text and tool-call fragments are bracketed by the
 * required start/delta/end parts across event boundaries. The first event also
 * yields the `response-metadata` part; the terminal `message-end` event yields
 * the closing `text-end` / `tool-params-end` / `tool-call` / `finish` parts
 * exactly once.
 */
const handleEvent = (
  event: Wire.ChatStreamEvent,
  state: StreamState,
  context: StreamContext,
): Array<Response.StreamPartEncoded> => {
  const out: Array<Response.StreamPartEncoded> = [];
  emitResponseMetadata(event, state, context, out);

  const content = event.delta?.message?.content;

  Match.value(event.type).pipe(
    Match.when(Match.is("content-start", "content-delta"), () => {
      if (Predicate.isNullish(content) || content.type === undefined || content.type === "text") {
        handleTextDelta(content?.text, state, context, out);
      }
    }),
    Match.when("content-end", () => {
      if (state.textStarted && !state.textEnded) {
        state.textEnded = true;
        out.push({ type: "text-end", id: context.textId });
      }
    }),
    Match.when(Match.is("tool-call-start", "tool-call-delta"), () =>
      handleToolCallDelta(event, state, context, out),
    ),
    Match.when("message-end", () =>
      finalize(state, context, out, event.delta?.finish_reason, event.delta?.usage),
    ),
    Match.orElse(() => undefined),
  );

  return out;
};

/** Emits the terminal stream parts for a completed streaming response. */
const finalize = (
  state: StreamState,
  context: StreamContext,
  out: Array<Response.StreamPartEncoded>,
  finishReason: string | null | undefined,
  usage: Wire.ChatResponse["usage"],
): void => {
  if (state.finished) {
    return;
  }
  state.finished = true;

  if (state.textStarted && !state.textEnded) {
    state.textEnded = true;
    out.push({ type: "text-end", id: context.textId });
  }

  for (const index of state.toolOrder) {
    const accumulator = state.tools.get(index);
    if (Predicate.isUndefined(accumulator)) {
      continue;
    }
    out.push({ type: "tool-params-end", id: accumulator.id });
    out.push({
      type: "tool-call",
      id: accumulator.id,
      name: accumulator.name,
      params: Wire.parseJsonLenient(Str.isNonEmpty(accumulator.args) ? accumulator.args : "{}"),
      providerExecuted: false,
    });
  }

  out.push({
    type: "finish",
    reason: mapFinishReason(finishReason),
    usage: makeUsage(usage, undefined),
    response: context.response,
  });
};
