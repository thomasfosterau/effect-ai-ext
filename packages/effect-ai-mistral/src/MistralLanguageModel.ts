/**
 * `MistralLanguageModel` — the Mistral implementation of Effect AI's
 * `LanguageModel` service. It translates Effect AI prompts, tools, and
 * structured-output requests into Mistral `/v1/chat/completions` requests
 * (via {@link MistralClient}), then converts regular and streaming Mistral
 * responses back into Effect AI response parts.
 *
 * The public surface mirrors `@effect/ai-anthropic`'s
 * `AnthropicLanguageModel`: {@link model} for a providable model
 * descriptor, {@link layer} for a `LanguageModel.LanguageModel` layer over
 * {@link MistralClient}, {@link make} for the service effect, and
 * {@link withConfigOverride} for per-effect request tuning. Nothing
 * downstream of `LanguageModel.LanguageModel` needs to know the provider is
 * Mistral.
 *
 * Structured output uses Mistral's native `json_schema` response format —
 * the model returns the JSON as ordinary message content, which the
 * framework parses against the caller's schema. Tool-call parameters are
 * returned as parsed JSON; the framework validates them against the toolkit.
 *
 * @module MistralLanguageModel
 *
 * @copyright Thomas Foster
 */

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
import { MistralClient } from "./MistralClient";
import * as Errors from "./internal/errors";
import * as Wire from "./internal/wire";

const MODULE = "MistralLanguageModel";

/**
 * A selection of well-known Mistral chat model ids, offered for
 * autocomplete only — the constructors accept any string.
 */
export type Model =
  | "mistral-large-latest"
  | "mistral-medium-latest"
  | "mistral-small-latest"
  | "magistral-medium-latest"
  | "magistral-small-latest"
  | "ministral-8b-latest"
  | "ministral-3b-latest"
  | "pixtral-large-latest"
  | "open-mistral-nemo"
  | "codestral-latest";

// =============================================================================
// Configuration
// =============================================================================

/**
 * The tunable request fields merged into every Mistral request. Values set
 * on the {@link Config} context service override those supplied to
 * {@link make}, {@link layer}, or {@link model}.
 */
export interface ConfigService {
  readonly model?: string | undefined;
  readonly temperature?: number | undefined;
  readonly topP?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly randomSeed?: number | undefined;
  readonly stop?: string | ReadonlyArray<string> | undefined;
  readonly presencePenalty?: number | undefined;
  readonly frequencyPenalty?: number | undefined;
}

/**
 * Context service carrying Mistral request defaults / per-operation
 * overrides. Provide it (or use {@link withConfigOverride}) to tune
 * generation without changing the model's construction-time config.
 */
export class Config extends Context.Service<Config, ConfigService>()(
  "@thomasfosterau/effect-ai-mistral/MistralLanguageModel/Config",
) {}

// =============================================================================
// Language Model
// =============================================================================

/**
 * Creates a Mistral model descriptor that can be provided with
 * `Effect.provide`, carrying provider and model metadata.
 *
 * @see {@link layer} for a `LanguageModel.LanguageModel` layer
 * @see {@link make} for the service effect
 */
export const model = (
  model: (string & {}) | Model,
  config?: Omit<ConfigService, "model">,
): AiModel.Model<"mistral", LanguageModel.LanguageModel, MistralClient> =>
  AiModel.make("mistral", model, layer({ model, config }));

/**
 * Constructs a `LanguageModel` service backed by {@link MistralClient}.
 * Request defaults from `config` are merged with any {@link Config} service
 * in context, the context values winning.
 *
 * @see {@link layer} for providing the service as a `Layer`
 * @see {@link model} for a providable model descriptor
 */
export const make = Effect.fnUntraced(function* ({
  model,
  config: providerConfig,
}: {
  readonly model: (string & {}) | Model;
  readonly config?: Omit<ConfigService, "model"> | undefined;
}): Effect.fn.Return<LanguageModel.LanguageModel, never, MistralClient> {
  const client = yield* MistralClient;

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
  ): Effect.Effect<Wire.ChatCompletionRequest, AiError.AiError> =>
    Effect.gen(function* () {
      const messages = yield* prepareMessages(options.prompt);
      const { tools, toolChoice } = yield* prepareTools(options);
      const responseFormat = yield* prepareResponseFormat(options);
      // Assemble every field (undefined for those unset) and drop the
      // undefined keys in one pass, rather than branching per field.
      // SAFETY: `compact` removes every `undefined` field, so each optional
      // `ChatCompletionRequest` field is either absent or set, as the wire
      // type requires.
      return compact({
        model: config.model,
        messages,
        stream,
        temperature: config.temperature,
        top_p: config.topP,
        max_tokens: config.maxTokens,
        random_seed: config.randomSeed,
        stop: config.stop,
        presence_penalty: config.presencePenalty,
        frequency_penalty: config.frequencyPenalty,
        tools,
        tool_choice: toolChoice,
        response_format: responseFormat,
      }) as Wire.ChatCompletionRequest;
    });

  return yield* LanguageModel.make({
    generateText: Effect.fnUntraced(function* (options) {
      const config = yield* makeConfig;
      const request = yield* buildRequest(config, options, false);
      const [body, response] = yield* client.createChatCompletion(request);
      return yield* makeResponse(body, response);
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
          const [response, chunks] = yield* client.createChatCompletionStream(request);
          const context: StreamContext = {
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
          return chunks.pipe(
            Stream.flatMap((chunk) => Stream.fromArray(handleChunk(chunk, state, context))),
          );
        }),
      ),
  });
});

/**
 * Provides {@link MistralLanguageModel} as a `LanguageModel.LanguageModel`
 * layer, drawing {@link MistralClient} from another layer.
 */
export const layer = (options: {
  readonly model: (string & {}) | Model;
  readonly config?: Omit<ConfigService, "model"> | undefined;
}): Layer.Layer<LanguageModel.LanguageModel, never, MistralClient> =>
  Layer.effect(LanguageModel.LanguageModel, make(options));

/**
 * Applies Mistral request overrides to one effect without changing the
 * model's default config. Overrides merge over any existing {@link Config}
 * service and win. Supports both data-first and data-last invocation.
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
 * non-image file part is rejected — Mistral chat completions accept images
 * only.
 */
const convertUserMessage = (
  message: Prompt.UserMessage,
): Effect.Effect<Wire.UserMessageRequest, AiError.AiError> =>
  Effect.gen(function* () {
    const parts: Array<Wire.RequestContentPart> = [];
    let hasNonText = false;
    for (const part of message.content) {
      if (part.type === "text") {
        parts.push({ type: "text", text: part.text });
        continue;
      }
      if (!part.mediaType.startsWith("image/")) {
        return yield* failure(
          "prepareMessages",
          new AiErrorNs.InvalidUserInputError({
            description: `Mistral chat completions support image files only; received '${part.mediaType}'`,
          }),
        );
      }
      hasNonText = true;
      parts.push({ type: "image_url", image_url: { url: fileToImageUrl(part) } });
    }
    return {
      role: "user",
      content: hasNonText
        ? parts
        : parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
    };
  });

/**
 * Converts an `assistant` message: text parts concatenate into `content`
 * (or `null` when empty), and framework-executed tool calls become
 * `tool_calls`. Reasoning / file / tool-result / approval parts have no
 * Mistral representation and are dropped.
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
    content: text.length > 0 ? text : null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : undefined),
  };
};

/** Converts a `tool` message into one Mistral `tool` message per result. */
const convertToolMessage = (message: Prompt.ToolMessage): Array<Wire.ToolMessageRequest> => {
  const messages: Array<Wire.ToolMessageRequest> = [];
  for (const part of message.content) {
    if (part.type !== "tool-result") {
      continue;
    }
    messages.push({
      role: "tool",
      tool_call_id: part.id,
      name: part.name,
      content: Predicate.isString(part.result) ? part.result : JSON.stringify(part.result),
    });
  }
  return messages;
};

/**
 * Converts an Effect AI prompt into the flat Mistral messages array. Each
 * Effect AI message maps to one Mistral message, except a `tool` message,
 * whose results each become their own Mistral `tool` message.
 */
const prepareMessages = (
  prompt: Prompt.Prompt,
): Effect.Effect<ReadonlyArray<Wire.MessageRequest>, AiError.AiError> =>
  Effect.gen(function* () {
    const messages: Array<Wire.MessageRequest> = [];
    for (const message of prompt.content) {
      switch (message.role) {
        case "system":
          messages.push({ role: "system", content: message.content });
          break;
        case "user":
          messages.push(yield* convertUserMessage(message));
          break;
        case "assistant":
          messages.push(convertAssistantMessage(message));
          break;
        case "tool":
          messages.push(...convertToolMessage(message));
          break;
      }
    }
    return messages;
  });

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

/** Converts one Effect AI tool into a Mistral function-tool definition. */
const buildToolRequest = (tool: Tool.Any): Effect.Effect<Wire.ToolRequest, AiError.AiError> =>
  Effect.gen(function* () {
    const name = tool.name;
    if (!Tool.isUserDefined(tool) && !Tool.isDynamic(tool)) {
      return yield* failure(
        "prepareTools",
        new AiErrorNs.InvalidUserInputError({
          description: `Mistral supports user-defined function tools only; received provider-defined tool '${name}'`,
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
  readonly toolChoice: Wire.ToolChoiceRequest;
}

/**
 * Maps Effect AI's tool-choice directive onto Mistral's, filtering the tool
 * set for a `oneOf` subset. `required` becomes Mistral's `"any"`.
 */
const resolveToolChoice = (
  toolChoice: LanguageModel.ProviderOptions["toolChoice"],
  tools: ReadonlyArray<Wire.ToolRequest>,
): ResolvedToolChoice => {
  if (toolChoice === "auto" || toolChoice === "none") {
    return { tools, toolChoice };
  }
  if (toolChoice === "required") {
    return { tools, toolChoice: "any" };
  }
  if ("tool" in toolChoice) {
    return { tools, toolChoice: { type: "function", function: { name: toolChoice.tool } } };
  }
  const allowed = new Set(toolChoice.oneOf);
  return {
    tools: tools.filter((tool) => allowed.has(tool.function.name)),
    toolChoice: toolChoice.mode === "required" ? "any" : "auto",
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
    if (options.tools.length === 0 || options.toolChoice === "none") {
      return { tools: undefined, toolChoice: undefined };
    }
    const tools: Array<Wire.ToolRequest> = [];
    for (const tool of options.tools) {
      tools.push(yield* buildToolRequest(tool));
    }
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
    return {
      type: "json_schema",
      json_schema: { name: responseFormat.objectName, schema, strict: true },
    };
  });

// =============================================================================
// Shared Response Helpers
// =============================================================================

const mapFinishReason = (reason: string | null | undefined): Response.FinishReason => {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
    case "model_length":
      return "length";
    case "tool_calls":
      return "tool-calls";
    case "content_filter":
      return "content-filter";
    case "error":
      return "error";
    default:
      return Predicate.isNullish(reason) ? "unknown" : "other";
  }
};

const makeUsage = (usage: Wire.ChatCompletionResponse["usage"]): typeof Response.Usage.Encoded => ({
  inputTokens: {
    uncached: undefined,
    total: usage?.prompt_tokens,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: usage?.completion_tokens,
    text: undefined,
    reasoning: undefined,
  },
});

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

const makeResponse = (
  body: Wire.ChatCompletionResponse,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<Array<Response.PartEncoded>, AiError.AiError, IdGenerator.IdGenerator> =>
  Effect.gen(function* () {
    const parts: Array<Response.PartEncoded> = [];
    const now = yield* DateTime.now;
    const responseDetails = buildResponseDetails(response);

    parts.push({
      type: "response-metadata",
      id: body.id,
      modelId: body.model,
      timestamp: DateTime.formatIso(now),
      request: buildRequestDetails(response.request),
    });

    const choice = body.choices[0];
    if (Predicate.isNotUndefined(choice)) {
      const content = choice.message.content;
      if (Predicate.isNotNullish(content) && content.length > 0) {
        parts.push({ type: "text", text: content });
      }
      const toolCalls = choice.message.tool_calls;
      if (Predicate.isNotNullish(toolCalls)) {
        for (const toolCall of toolCalls) {
          parts.push({
            type: "tool-call",
            id: toolCall.id ?? (yield* generateId()),
            name: toolCall.function.name,
            params: Wire.parseJsonLenient(toolCall.function.arguments),
            providerExecuted: false,
          });
        }
      }
      parts.push({
        type: "finish",
        reason: mapFinishReason(choice.finish_reason),
        usage: makeUsage(body.usage),
        response: responseDetails,
      });
    } else {
      parts.push({
        type: "finish",
        reason: "unknown",
        usage: makeUsage(body.usage),
        response: responseDetails,
      });
    }

    return parts;
  });

const generateId = (): Effect.Effect<string, never, IdGenerator.IdGenerator> =>
  Effect.flatMap(IdGenerator.IdGenerator, (idGen) => idGen.generateId());

// =============================================================================
// Streaming Response Conversion
// =============================================================================

/** Per-stream immutable context: the synthesised text id and metadata. */
interface StreamContext {
  readonly textId: string;
  readonly timestamp: string;
  readonly request: typeof Response.HttpRequestDetails.Encoded;
  readonly response: typeof Response.HttpResponseDetails.Encoded;
}

/** Accumulated state for one streamed tool call, keyed by its delta index. */
interface ToolAccumulator {
  id: string;
  name: string;
  started: boolean;
  args: string;
}

/** Mutable per-stream state threaded across chunks. */
interface StreamState {
  metadataEmitted: boolean;
  textStarted: boolean;
  textEnded: boolean;
  finished: boolean;
  readonly tools: Map<number, ToolAccumulator>;
  readonly toolOrder: Array<number>;
}

/**
 * Converts one Mistral streaming chunk into zero or more Effect AI stream
 * parts, mutating `state` so text and tool-call fragments are bracketed by
 * the required start/delta/end parts across chunk boundaries. The first
 * chunk also yields the `response-metadata` part; the chunk carrying a
 * `finish_reason` (or a trailing usage-only chunk) yields the terminal
 * `text-end`/`tool-params-end`/`tool-call`/`finish` parts exactly once.
 */
const emitResponseMetadata = (
  chunk: Wire.ChatCompletionChunk,
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
    id: chunk.id,
    modelId: chunk.model,
    timestamp: context.timestamp,
    request: context.request,
  });
};

const handleTextDelta = (
  content: string | null | undefined,
  state: StreamState,
  context: StreamContext,
  out: Array<Response.StreamPartEncoded>,
): void => {
  if (!Predicate.isNotNullish(content) || content.length === 0) {
    return;
  }
  if (!state.textStarted) {
    state.textStarted = true;
    out.push({ type: "text-start", id: context.textId });
  }
  out.push({ type: "text-delta", id: context.textId, delta: content });
};

/**
 * Returns the accumulator for a streamed tool call's index, creating and
 * registering it on first sight and back-filling a name that arrived in a
 * later fragment.
 */
const getOrCreateToolAccumulator = (
  toolCall: Wire.ChunkToolCall,
  index: number,
  state: StreamState,
  context: StreamContext,
): ToolAccumulator => {
  const existing = state.tools.get(index);
  if (Predicate.isNotUndefined(existing)) {
    if (existing.name.length === 0 && Predicate.isNotUndefined(toolCall.function?.name)) {
      existing.name = toolCall.function.name;
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
  toolCall: Wire.ChunkToolCall,
  state: StreamState,
  context: StreamContext,
  out: Array<Response.StreamPartEncoded>,
): void => {
  const index = toolCall.index ?? 0;
  const accumulator = getOrCreateToolAccumulator(toolCall, index, state, context);

  if (!accumulator.started) {
    accumulator.started = true;
    out.push({ type: "tool-params-start", id: accumulator.id, name: accumulator.name });
  }

  const argsFragment = toolCall.function?.arguments;
  if (Predicate.isNotUndefined(argsFragment) && argsFragment.length > 0) {
    accumulator.args += argsFragment;
    out.push({ type: "tool-params-delta", id: accumulator.id, delta: argsFragment });
  }
};

const handleChunk = (
  chunk: Wire.ChatCompletionChunk,
  state: StreamState,
  context: StreamContext,
): Array<Response.StreamPartEncoded> => {
  const out: Array<Response.StreamPartEncoded> = [];
  emitResponseMetadata(chunk, state, context, out);

  const choice = chunk.choices[0];
  if (Predicate.isUndefined(choice)) {
    if (!state.finished && Predicate.isNotNullish(chunk.usage)) {
      finalize(state, context, out, chunk, "stop");
    }
    return out;
  }

  handleTextDelta(choice.delta.content, state, context, out);

  const toolCalls = choice.delta.tool_calls;
  if (Predicate.isNotNullish(toolCalls)) {
    for (const toolCall of toolCalls) {
      handleToolCallDelta(toolCall, state, context, out);
    }
  }

  if (Predicate.isNotNullish(choice.finish_reason)) {
    finalize(state, context, out, chunk, choice.finish_reason);
  }

  return out;
};

/** Emits the terminal stream parts for a completed streaming response. */
const finalize = (
  state: StreamState,
  context: StreamContext,
  out: Array<Response.StreamPartEncoded>,
  chunk: Wire.ChatCompletionChunk,
  finishReason: string,
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
      params: Wire.parseJsonLenient(accumulator.args.length > 0 ? accumulator.args : "{}"),
      providerExecuted: false,
    });
  }

  out.push({
    type: "finish",
    reason: mapFinishReason(finishReason),
    usage: makeUsage(chunk.usage),
    response: context.response,
  });
};
