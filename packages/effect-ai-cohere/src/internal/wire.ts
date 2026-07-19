/**
 * @copyright Thomas Foster
 *
 * Wire-format definitions for Cohere's v2 API — `/v2/chat` (regular and
 * streaming), `/v2/embed`, and `/v2/rerank`.
 *
 * Request payloads are hand-built plain objects (typed by the `*Request`
 * interfaces here) rather than encoded through a schema — the provider
 * constructs them field-by-field and sends them as JSON. Only the response
 * and streaming-event bodies get Effect `Schema`s, because those are the
 * untrusted inputs that must be decoded and validated before the models
 * convert them into Effect AI / effect-ai-ext response shapes.
 *
 * Optional response fields are modelled leniently (`Schema.optional` +
 * `Schema.NullOr`, and `finish_reason` left as a free `string`) so that a
 * newly-added Cohere field or finish reason never fails decoding of an
 * otherwise-valid response — the mapping layer narrows the strings it knows
 * and defaults the rest. Cohere reports token usage under either `usage` or
 * `meta` depending on the surface, so both are decoded and the mapper reads
 * whichever is present.
 *
 * @module internal/wire
 */

import * as Schema from "effect/Schema";

// ── Chat request ──────────────────────────────────────────────────────

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

/** An assistant tool call replayed back to Cohere in conversation history. */
export interface RequestToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
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
  readonly content?: string | null;
  readonly tool_plan?: string;
  readonly tool_calls?: ReadonlyArray<RequestToolCall>;
}

/** `tool` role request message carrying one tool result. */
export interface ToolMessageRequest {
  readonly role: "tool";
  readonly tool_call_id: string;
  readonly content: string;
}

/** Any message accepted by the chat request. */
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
 * The tool-choice modes Cohere v2 accepts. `"REQUIRED"` forces a tool call;
 * `"NONE"` forbids one. Cohere has no value for "auto" or for pinning a
 * specific tool — those are expressed by omitting `tool_choice` and/or
 * filtering the `tools` array (see `CohereLanguageModel`).
 */
export type ToolChoiceRequest = "REQUIRED" | "NONE";

/** The response-format directive controlling text vs. JSON output. */
export type ResponseFormatRequest =
  | { readonly type: "json_object" }
  | { readonly type: "json_object"; readonly schema: unknown };

/** The full `/v2/chat` request body. */
export interface ChatRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<MessageRequest>;
  readonly stream?: boolean;
  readonly temperature?: number;
  /** Nucleus sampling probability (Cohere's `p`, i.e. OpenAI's `top_p`). */
  readonly p?: number;
  /** Top-k sampling (Cohere's `k`). */
  readonly k?: number;
  readonly max_tokens?: number;
  readonly seed?: number;
  readonly stop_sequences?: ReadonlyArray<string>;
  readonly frequency_penalty?: number;
  readonly presence_penalty?: number;
  readonly tools?: ReadonlyArray<ToolRequest>;
  readonly tool_choice?: ToolChoiceRequest;
  readonly response_format?: ResponseFormatRequest;
}

// ── Chat response (non-streaming) ─────────────────────────────────────

/** Token accounting reported under `tokens` / `billed_units`. */
const UsageTokens = Schema.Struct({
  input_tokens: Schema.optional(Schema.NullOr(Schema.Finite)),
  output_tokens: Schema.optional(Schema.NullOr(Schema.Finite)),
});

/** The usage envelope — Cohere reports it as `usage` on chat, `meta` elsewhere. */
const Usage = Schema.Struct({
  tokens: Schema.optional(Schema.NullOr(UsageTokens)),
  billed_units: Schema.optional(Schema.NullOr(UsageTokens)),
});

/** A text content block in a non-streaming assistant message. */
const ResponseContentPart = Schema.Struct({
  type: Schema.optional(Schema.String),
  text: Schema.optional(Schema.NullOr(Schema.String)),
});

/** A completed tool call in a non-streaming response message. */
const ResponseToolCall = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.optional(Schema.String),
  function: Schema.Struct({
    name: Schema.String,
    arguments: Schema.optional(Schema.NullOr(Schema.String)),
  }),
});

/** The assistant message body of a non-streaming chat response. */
const ResponseMessage = Schema.Struct({
  role: Schema.optional(Schema.String),
  content: Schema.optional(Schema.NullOr(Schema.Array(ResponseContentPart))),
  tool_plan: Schema.optional(Schema.NullOr(Schema.String)),
  tool_calls: Schema.optional(Schema.NullOr(Schema.Array(ResponseToolCall))),
});

/** The decoded body of a non-streaming `/v2/chat` response. */
export const ChatResponse = Schema.Struct({
  id: Schema.optional(Schema.String),
  message: ResponseMessage,
  finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
  usage: Schema.optional(Schema.NullOr(Usage)),
  meta: Schema.optional(Schema.NullOr(Usage)),
});

/** Decoded non-streaming chat response type. */
export type ChatResponse = typeof ChatResponse.Type;

// ── Chat streaming events ─────────────────────────────────────────────

/** The incremental content block carried by a streaming content event. */
const StreamContent = Schema.Struct({
  type: Schema.optional(Schema.String),
  text: Schema.optional(Schema.NullOr(Schema.String)),
});

/** An incremental tool-call fragment within a streaming delta. */
const StreamToolCall = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.optional(Schema.String),
  function: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        name: Schema.optional(Schema.NullOr(Schema.String)),
        arguments: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});

/** Decoded incremental tool-call fragment. */
export type StreamToolCall = typeof StreamToolCall.Type;

/**
 * The `delta.message` payload. Cohere sends `tool_calls` as a single object
 * on `tool-call-start` / `tool-call-delta`; some transports emit it as a
 * one-element array, so both are accepted and normalised by the mapper.
 */
const StreamDeltaMessage = Schema.Struct({
  role: Schema.optional(Schema.String),
  content: Schema.optional(Schema.NullOr(StreamContent)),
  tool_plan: Schema.optional(Schema.NullOr(Schema.String)),
  tool_calls: Schema.optional(
    Schema.NullOr(Schema.Union([StreamToolCall, Schema.Array(StreamToolCall)])),
  ),
});

/** The `delta` payload shared by every streaming event. */
const StreamDelta = Schema.Struct({
  message: Schema.optional(Schema.NullOr(StreamDeltaMessage)),
  finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
  usage: Schema.optional(Schema.NullOr(Usage)),
});

/** The decoded body of a single `/v2/chat` (streaming) SSE event. */
export const ChatStreamEvent = Schema.Struct({
  type: Schema.optional(Schema.String),
  index: Schema.optional(Schema.NullOr(Schema.Int)),
  id: Schema.optional(Schema.String),
  delta: Schema.optional(Schema.NullOr(StreamDelta)),
});

/** Decoded streaming-event type. */
export type ChatStreamEvent = typeof ChatStreamEvent.Type;

// ── Embed ─────────────────────────────────────────────────────────────

/** The `/v2/embed` request body. */
export interface EmbedRequest {
  readonly model: string;
  readonly input_type: string;
  readonly texts: ReadonlyArray<string>;
  readonly output_dimension?: number;
  readonly embedding_types: ReadonlyArray<string>;
}

/** The decoded body of a `/v2/embed` response. */
export const EmbedResponse = Schema.Struct({
  embeddings: Schema.Struct({
    float: Schema.Array(Schema.Array(Schema.Finite)),
  }),
  meta: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        billed_units: Schema.optional(
          Schema.NullOr(Schema.Struct({ input_tokens: Schema.optional(Schema.Finite) })),
        ),
      }),
    ),
  ),
});

/** Decoded embed response type. */
export type EmbedResponse = typeof EmbedResponse.Type;

// ── Rerank ────────────────────────────────────────────────────────────

/** The `/v2/rerank` request body. */
export interface RerankRequest {
  readonly model: string;
  readonly query: string;
  readonly documents: ReadonlyArray<string>;
  readonly top_n?: number;
}

/** The decoded body of a `/v2/rerank` response. */
export const RerankResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      index: Schema.Int,
      relevance_score: Schema.Finite,
    }),
  ),
  meta: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        billed_units: Schema.optional(
          Schema.NullOr(Schema.Struct({ search_units: Schema.optional(Schema.Finite) })),
        ),
      }),
    ),
  ),
});

/** Decoded rerank response type. */
export type RerankResponse = typeof RerankResponse.Type;
