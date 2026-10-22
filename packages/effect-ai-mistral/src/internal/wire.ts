/**
 * Wire-format definitions for Mistral's `/v1/chat/completions` endpoint.
 *
 * Request payloads are hand-built plain objects (typed by the `*Request`
 * interfaces here) rather than encoded through a schema — the provider
 * constructs them field-by-field and sends them as JSON. Only the response
 * and streaming-chunk bodies get Effect `Schema`s, because those are the
 * untrusted inputs that must be decoded and validated before the language
 * model converts them into Effect AI response parts.
 *
 * Optional response fields are modelled leniently (`Schema.optional` +
 * `Schema.NullOr`, and `finish_reason` left as a free `string`) so that a
 * newly-added Mistral field or finish reason never fails decoding of an
 * otherwise-valid response — the mapping layer narrows the strings it knows
 * and defaults the rest.
 *
 * @module internal/wire
 *
 * @copyright Thomas Foster
 */

import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

// ── Request ───────────────────────────────────────────────────────────

/** A text content block in a multi-part user message. */
export interface RequestTextPart {
  readonly type: "text";
  readonly text: string;
}

/** An image content block (data URL or remote URL) in a user message. */
export interface RequestImagePart {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
}

/** A single content block accepted inside a user message array. */
export type RequestContentPart = RequestTextPart | RequestImagePart;

/** An assistant tool call replayed back to Mistral in conversation history. */
export interface RequestToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string | undefined;
  };
}

/** `system` role request message. */
export interface SystemMessageRequest {
  readonly role: "system";
  readonly content: string;
}

/** `user` role request message — plain text or multi-modal content blocks. */
export interface UserMessageRequest {
  readonly role: "user";
  readonly content: string | ReadonlyArray<RequestContentPart>;
}

/** `assistant` role request message, optionally carrying tool calls. */
export interface AssistantMessageRequest {
  readonly role: "assistant";
  readonly content: string | null;
  readonly tool_calls?: ReadonlyArray<RequestToolCall>;
  readonly prefix?: boolean;
}

/** `tool` role request message carrying one tool result. */
export interface ToolMessageRequest {
  readonly role: "tool";
  readonly tool_call_id: string;
  readonly name?: string;
  readonly content: string | undefined;
}

/** Any message accepted by the chat completions request. */
export type MessageRequest =
  | SystemMessageRequest
  | UserMessageRequest
  | AssistantMessageRequest
  | ToolMessageRequest;

/** A user-defined function tool offered to the model. */
export interface ToolRequest {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: unknown;
  };
}

/**
 * The tool-choice modes Mistral accepts. `"any"` and `"required"` both force
 * a tool call; `{ type: "function", ... }` pins a specific tool.
 */
export type ToolChoiceRequest =
  | "auto"
  | "none"
  | "any"
  | "required"
  | { readonly type: "function"; readonly function: { readonly name: string } };

/** The response-format directive controlling text vs. JSON output. */
export type ResponseFormatRequest =
  | { readonly type: "text" }
  | { readonly type: "json_object" }
  | {
      readonly type: "json_schema";
      readonly json_schema: {
        readonly name: string;
        readonly schema: unknown;
        readonly strict?: boolean;
      };
    };

/** The full `/v1/chat/completions` request body. */
export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<MessageRequest>;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly max_tokens?: number;
  readonly random_seed?: number;
  readonly stop?: string | ReadonlyArray<string>;
  readonly presence_penalty?: number;
  readonly frequency_penalty?: number;
  readonly stream?: boolean;
  readonly tools?: ReadonlyArray<ToolRequest>;
  readonly tool_choice?: ToolChoiceRequest;
  readonly response_format?: ResponseFormatRequest;
}

// ── Response ──────────────────────────────────────────────────────────

/** Token accounting reported by Mistral on completions and final chunks. */
const Usage = Schema.Struct({
  prompt_tokens: Schema.optional(Schema.Number),
  completion_tokens: Schema.optional(Schema.Number),
  total_tokens: Schema.optional(Schema.Number),
});

/** A completed tool call in a non-streaming response message. */
const ResponseToolCall = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  function: Schema.Struct({
    name: Schema.String,
    arguments: Schema.String,
  }),
});

/** The assistant message body of a non-streaming choice. */
const ResponseMessage = Schema.Struct({
  role: Schema.optional(Schema.String),
  content: Schema.optional(Schema.NullOr(Schema.String)),
  tool_calls: Schema.optional(Schema.NullOr(Schema.Array(ResponseToolCall))),
});

/** One choice in a non-streaming completion. */
const ResponseChoice = Schema.Struct({
  index: Schema.optional(Schema.Number),
  message: ResponseMessage,
  finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
});

/**
 * The identity/usage envelope shared by both the completion and streaming
 * chunk bodies. Spread into each so the shared shape lives in one place.
 */
const envelope = {
  id: Schema.optional(Schema.String),
  object: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  created: Schema.optional(Schema.Number),
  usage: Schema.optional(Schema.NullOr(Usage)),
} as const;

/** The decoded body of a non-streaming `/v1/chat/completions` response. */
export const ChatCompletionResponse = Schema.Struct({
  ...envelope,
  choices: Schema.Array(ResponseChoice),
});

/** Decoded non-streaming response type. */
export type ChatCompletionResponse = typeof ChatCompletionResponse.Type;

// ── Streaming chunk ───────────────────────────────────────────────────

/** An incremental tool call fragment within a streaming delta. */
const DeltaToolCall = Schema.Struct({
  index: Schema.optional(Schema.Number),
  id: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  function: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      arguments: Schema.optional(Schema.String),
    }),
  ),
});

/** Decoded incremental tool-call fragment. */
export type ChunkToolCall = typeof DeltaToolCall.Type;

/** The incremental message delta carried by a streaming choice. */
const ChunkDelta = Schema.Struct({
  role: Schema.optional(Schema.String),
  content: Schema.optional(Schema.NullOr(Schema.String)),
  tool_calls: Schema.optional(Schema.NullOr(Schema.Array(DeltaToolCall))),
});

/** One choice in a streaming chunk. */
const ChunkChoice = Schema.Struct({
  index: Schema.optional(Schema.Number),
  delta: ChunkDelta,
  finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
});

/** The decoded body of a single `chat.completion.chunk` SSE event. */
export const ChatCompletionChunk = Schema.Struct({
  ...envelope,
  choices: Schema.Array(ChunkChoice),
});

/** Decoded streaming-chunk type. */
export type ChatCompletionChunk = typeof ChatCompletionChunk.Type;

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

/**
 * Parses `text` as JSON, or returns `text` itself when it is not JSON. Used
 * for SSE frames and tool-call arguments: a frame that is not JSON reaches
 * the schema decoder as a plain string and fails there as an ordinary
 * `SchemaError`, and a malformed tool-argument string is handed on as-is
 * rather than thrown.
 */
export const parseJsonLenient = (text: string): Schema.Json =>
  Option.getOrElse(decodeJson(text), () => text);

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/**
 * Serialises `value` as JSON text, with `JSON.stringify`'s contract: an
 * `undefined` value (a tool that returns nothing) has no JSON text, so it
 * stays `undefined` and its key is left off the serialised request body.
 */
export const stringifyJson = <A>(value: A): string | undefined =>
  Predicate.isUndefined(value) ? undefined : encodeJson(value);
