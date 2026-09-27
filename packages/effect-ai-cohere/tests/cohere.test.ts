/**
 * Unit tests for the first-party Cohere Effect AI provider — `CohereClient`
 * and the four model surfaces (`CohereLanguageModel`, `CohereEmbeddingModel`,
 * `CohereRerankerModel`, `CohereClassifierModel`).
 *
 * The network is stubbed at `FetchHttpClient.Fetch` — the same technique the
 * gateway and mistral provider tests use. Each stub captures the outgoing
 * request (URL, `authorization` header, JSON body) and returns a canned Cohere
 * v2 response (or an SSE stream), so the tests exercise request construction,
 * prompt / tool / structured-output conversion, and response decoding without
 * reaching the network. No live key is ever used.
 *
 * @module tests/cohere
 */

import { describe, expect, it } from "vitest";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AiError, EmbeddingModel, LanguageModel, Tool, Toolkit } from "effect/unstable/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ClassifierModel, RerankerModel } from "@thomasfosterau/effect-ai-ext";
import {
  CohereClient,
  CohereClassifierModel,
  CohereEmbeddingModel,
  CohereLanguageModel,
  CohereRerankerModel,
} from "@thomasfosterau/effect-ai-cohere";
import { expectFailureInstanceOf, runTest } from "./helpers/effect";

// ── Fetch stubbing ────────────────────────────────────────────────────

interface CapturedRequest {
  readonly url: string;
  readonly authorization: string | null;
  readonly headers: Record<string, string>;
  readonly body: RequestBody;
}

interface RequestBody {
  readonly model?: string;
  readonly stream?: boolean;
  readonly temperature?: number;
  readonly messages?: ReadonlyArray<Record<string, unknown>>;
  readonly tools?: ReadonlyArray<Record<string, unknown>>;
  readonly tool_choice?: unknown;
  readonly response_format?: { readonly type?: string; readonly schema?: unknown };
  readonly input_type?: string;
  readonly texts?: ReadonlyArray<string>;
  readonly output_dimension?: number;
  readonly embedding_types?: ReadonlyArray<string>;
  readonly query?: string;
  readonly documents?: ReadonlyArray<string>;
  readonly top_n?: number;
  readonly [key: string]: unknown;
}

const makeFetch = (respond: (captured: CapturedRequest) => Response) => {
  const calls: Array<CapturedRequest> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as RequestBody;
    const captured: CapturedRequest = {
      url: request.url,
      authorization: request.headers.get("authorization"),
      headers: Object.fromEntries(request.headers),
      body,
    };
    calls.push(captured);
    return respond(captured);
  };
  return { calls, fetch };
};

const httpLayer = (fetch: typeof globalThis.fetch) =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)));

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Builds a Cohere v2 SSE stream — `data:`-framed events, closed (no sentinel). */
const sseResponse = (frames: ReadonlyArray<unknown>): Response => {
  const text = frames
    .map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`)
    .join("");
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const chatReply = (over?: Record<string, unknown>) => ({
  id: "c1",
  message: { role: "assistant", content: [{ type: "text", text: "Bonjour" }] },
  finish_reason: "COMPLETE",
  usage: { tokens: { input_tokens: 10, output_tokens: 3 } },
  ...over,
});

const clientLayer = (
  fetch: typeof globalThis.fetch,
  options?: { readonly apiKey?: Redacted.Redacted<string>; readonly apiUrl?: string },
) =>
  CohereClient.layer({
    apiKey: options?.apiKey ?? Redacted.make("test-key"),
    ...(options?.apiUrl !== undefined ? { apiUrl: options.apiUrl } : undefined),
  }).pipe(Layer.provide(httpLayer(fetch)));

const modelLayer = (
  fetch: typeof globalThis.fetch,
  options?: {
    readonly apiKey?: Redacted.Redacted<string>;
    readonly config?: Omit<CohereLanguageModel.ConfigService, "model">;
  },
) =>
  CohereLanguageModel.layer({ model: "command-a-03-2025", config: options?.config }).pipe(
    Layer.provide(clientLayer(fetch, { apiKey: options?.apiKey })),
  );

// ── Text generation ───────────────────────────────────────────────────

describe("CohereLanguageModel.generateText", () => {
  it("posts to /v2/chat with a bearer token and decodes the reply", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    const response = await runTest(
      LanguageModel.generateText({ prompt: "dis bonjour" }).pipe(Effect.provide(modelLayer(fetch))),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.cohere.com/v2/chat");
    expect(calls[0]?.authorization).toBe("Bearer test-key");
    expect(calls[0]?.body.model).toBe("command-a-03-2025");
    expect(calls[0]?.body.stream).toBe(false);
    expect(response.text).toBe("Bonjour");
    expect(response.usage.inputTokens.total).toBe(10);
    expect(response.usage.outputTokens.total).toBe(3);
    expect(response.finishReason).toBe("stop");
  });

  it("omits the authorization header when constructed without an API key", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(
          CohereLanguageModel.layer({ model: "command-r" }).pipe(
            Layer.provide(CohereClient.layer({})),
            Layer.provide(httpLayer(fetch)),
          ),
        ),
      ),
    );

    expect(calls[0]?.authorization).toBeNull();
  });

  it("translates each prompt message into its Cohere wire form", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    await runTest(
      LanguageModel.generateText({
        prompt: [
          { role: "system", content: "be brief" },
          {
            role: "user",
            content: [
              { type: "text", text: "look" },
              { type: "file", mediaType: "image/png", data: "data:image/png;base64,AAAA" },
            ],
          },
          {
            role: "assistant",
            content: [
              { type: "text", text: "checking" },
              {
                type: "tool-call",
                id: "call_1",
                name: "get_weather",
                params: { city: "Paris" },
                providerExecuted: false,
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                id: "call_1",
                name: "get_weather",
                isFailure: false,
                result: { temp: 20 },
              },
            ],
          },
        ],
      }).pipe(Effect.provide(modelLayer(fetch))),
    );

    const messages = calls[0]?.body.messages ?? [];
    expect(messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    });
    expect(messages[2]).toEqual({
      role: "assistant",
      content: "checking",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Paris"}' },
        },
      ],
    });
    expect(messages[3]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: '{"temp":20}',
    });
  });

  it("collapses a text-only user message into a plain string", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    await runTest(
      LanguageModel.generateText({ prompt: "just text" }).pipe(Effect.provide(modelLayer(fetch))),
    );

    expect(calls[0]?.body.messages?.[0]).toEqual({ role: "user", content: "just text" });
  });

  it("rejects unsupported (non-image) file parts with an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse(chatReply()));

    await expectFailureInstanceOf(
      LanguageModel.generateText({
        prompt: [
          { role: "user", content: [{ type: "file", mediaType: "application/zip", data: "AAAA" }] },
        ],
      }).pipe(Effect.provide(modelLayer(fetch))),
      AiError.AiError,
    );
  });

  it("maps a non-2xx status to an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse({ message: "rate limited" }, 429));

    await expectFailureInstanceOf(
      LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
      AiError.AiError,
    );
  });

  it("maps an undecodable success body to an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse({ not: "a chat reply" }));

    await expectFailureInstanceOf(
      LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
      AiError.AiError,
    );
  });
});

// ── Configuration & apiUrl (BYOK) override ────────────────────────────

describe("CohereLanguageModel configuration", () => {
  it("threads construction-time config into the request", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(modelLayer(fetch, { config: { temperature: 0.2, maxTokens: 128 } })),
      ),
    );

    expect(calls[0]?.body.temperature).toBe(0.2);
    expect((calls[0]?.body as Record<string, unknown>).max_tokens).toBe(128);
  });

  it("lets withConfigOverride win over construction-time config", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        CohereLanguageModel.withConfigOverride({ temperature: 0.9 }),
        Effect.provide(modelLayer(fetch, { config: { temperature: 0.2 } })),
      ),
    );

    expect(calls[0]?.body.temperature).toBe(0.9);
  });

  it("threads every tunable config field into the request body", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(
          modelLayer(fetch, {
            config: {
              temperature: 0.1,
              topP: 0.9,
              topK: 20,
              maxTokens: 64,
              seed: 7,
              stopSequences: ["STOP"],
              presencePenalty: 0.5,
              frequencyPenalty: 0.25,
            },
          }),
        ),
      ),
    );

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.p).toBe(0.9);
    expect(body.k).toBe(20);
    expect(body.max_tokens).toBe(64);
    expect(body.seed).toBe(7);
    expect(body.stop_sequences).toEqual(["STOP"]);
    expect(body.presence_penalty).toBe(0.5);
    expect(body.frequency_penalty).toBe(0.25);
  });

  it("routes requests through an apiUrl override (BYOK contract)", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(
          CohereLanguageModel.layer({ model: "command-r" }).pipe(
            Layer.provide(clientLayer(fetch, { apiUrl: "https://gateway.example/cohere" })),
          ),
        ),
      ),
    );

    expect(calls[0]?.url).toBe("https://gateway.example/cohere/v2/chat");
    expect(calls[0]?.authorization).toBe("Bearer test-key");
  });

  it("provides the model through a Config-driven client layer with apiUrl override", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    const configuredClient = CohereClient.layerConfig({
      apiKey: Config.succeed(Redacted.make("cfg-key")),
      apiUrl: Config.succeed("https://proxy.example"),
    }).pipe(Layer.provide(httpLayer(fetch)));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(
          CohereLanguageModel.layer({ model: "command-r7b-12-2024" }).pipe(
            Layer.provide(configuredClient),
          ),
        ),
      ),
    );

    expect(calls[0]?.url).toBe("https://proxy.example/v2/chat");
    expect(calls[0]?.authorization).toBe("Bearer cfg-key");
  });

  it("applies a transformClient to outgoing requests", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(
          CohereLanguageModel.layer({ model: "command-r" }).pipe(
            Layer.provide(
              CohereClient.layer({
                apiKey: Redacted.make("k"),
                transformClient: (client) =>
                  HttpClient.mapRequest(client, HttpClientRequest.setHeader("x-test", "1")),
              }).pipe(Layer.provide(httpLayer(fetch))),
            ),
          ),
        ),
      ),
    );

    expect(calls[0]?.headers["x-test"]).toBe("1");
  });

  it("maps a transport failure to an AiError", async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new TypeError("network down");
    };

    await expectFailureInstanceOf(
      LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
      AiError.AiError,
    );
  });
});

// ── Structured output ─────────────────────────────────────────────────

describe("CohereLanguageModel.generateObject", () => {
  it("requests a json_object response format with a schema and decodes the object", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(
        chatReply({
          message: {
            role: "assistant",
            content: [{ type: "text", text: JSON.stringify({ city: "Paris" }) }],
          },
        }),
      ),
    );

    const response = await runTest(
      LanguageModel.generateObject({
        prompt: "which city",
        objectName: "city_result",
        schema: Schema.Struct({ city: Schema.String }),
      }).pipe(Effect.provide(modelLayer(fetch))),
    );

    expect(calls[0]?.body.response_format?.type).toBe("json_object");
    expect(calls[0]?.body.response_format?.schema).toBeDefined();
    expect(response.value).toEqual({ city: "Paris" });
  });
});

// ── Tool calling ──────────────────────────────────────────────────────

const weatherTool = Tool.make("get_weather", {
  description: "Look up the weather for a city",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.String,
});
const weatherToolkit = Toolkit.make(weatherTool);
const weatherHandlers = weatherToolkit.toLayer({
  get_weather: ({ city }) => Effect.succeed(`sunny in ${city}`),
});

const toolCallReply = (over?: Record<string, unknown>) =>
  chatReply({
    message: {
      role: "assistant",
      tool_plan: "I will look up the weather.",
      tool_calls: [
        {
          id: "call_9",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Paris"}' },
        },
      ],
    },
    finish_reason: "TOOL_CALL",
    ...over,
  });

describe("CohereLanguageModel tool calling", () => {
  it("sends tool definitions and resolves the model's tool call", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(toolCallReply()));

    const response = await runTest(
      LanguageModel.generateText({ prompt: "weather in Paris?", toolkit: weatherToolkit }).pipe(
        Effect.provide(modelLayer(fetch)),
        Effect.provide(weatherHandlers),
      ),
    );

    const tools = calls[0]?.body.tools ?? [];
    expect((tools[0] as { function?: { name?: string } })?.function?.name).toBe("get_weather");
    // "auto" — Cohere expresses it by omitting tool_choice.
    expect(calls[0]?.body.tool_choice).toBeUndefined();
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolResults[0]?.result).toBe("sunny in Paris");
    expect(response.finishReason).toBe("tool-calls");
  });

  it('maps a required tool choice to Cohere\'s "REQUIRED"', async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(toolCallReply()));

    await runTest(
      LanguageModel.generateText({
        prompt: "weather?",
        toolkit: weatherToolkit,
        toolChoice: "required",
      }).pipe(Effect.provide(modelLayer(fetch)), Effect.provide(weatherHandlers)),
    );

    expect(calls[0]?.body.tool_choice).toBe("REQUIRED");
  });

  it("pins a specific tool by filtering the tool set and requiring a call", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(toolCallReply()));

    await runTest(
      LanguageModel.generateText({
        prompt: "weather?",
        toolkit: weatherToolkit,
        toolChoice: { tool: "get_weather" },
      }).pipe(Effect.provide(modelLayer(fetch)), Effect.provide(weatherHandlers)),
    );

    expect(calls[0]?.body.tool_choice).toBe("REQUIRED");
    expect(calls[0]?.body.tools).toHaveLength(1);
  });

  it("restricts tools to a required oneOf subset", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(toolCallReply()));

    await runTest(
      LanguageModel.generateText({
        prompt: "weather?",
        toolkit: weatherToolkit,
        toolChoice: { mode: "required", oneOf: ["get_weather"] },
      }).pipe(Effect.provide(modelLayer(fetch)), Effect.provide(weatherHandlers)),
    );

    expect(calls[0]?.body.tool_choice).toBe("REQUIRED");
    expect(calls[0]?.body.tools).toHaveLength(1);
  });

  it("synthesises an id for a tool call the model returned without one", async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(
        toolCallReply({
          message: {
            role: "assistant",
            tool_calls: [
              { type: "function", function: { name: "get_weather", arguments: '{"city":"Caen"}' } },
            ],
          },
        }),
      ),
    );

    const response = await runTest(
      LanguageModel.generateText({
        prompt: "weather?",
        toolkit: weatherToolkit,
        disableToolCallResolution: true,
      }).pipe(Effect.provide(modelLayer(fetch)), Effect.provide(weatherHandlers)),
    );

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]?.id).toBeTypeOf("string");
  });
});

// ── Finish reasons ────────────────────────────────────────────────────

describe("CohereLanguageModel finish reasons", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["COMPLETE", "stop"],
    ["STOP_SEQUENCE", "stop"],
    ["MAX_TOKENS", "length"],
    ["TOOL_CALL", "tool-calls"],
    ["ERROR_TOXIC", "content-filter"],
    ["ERROR", "error"],
    ["something_new", "other"],
  ];

  for (const [wire, expected] of cases) {
    it(`maps the "${wire}" finish reason to "${expected}"`, async () => {
      const { fetch } = makeFetch(() =>
        jsonResponse(
          chatReply({
            message: { role: "assistant", content: [{ type: "text", text: "x" }] },
            finish_reason: wire,
          }),
        ),
      );

      const response = await runTest(
        LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
      );

      expect(response.finishReason).toBe(expected);
    });
  }

  it("maps a null finish reason to unknown", async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(
        chatReply({
          message: { role: "assistant", content: [{ type: "text", text: "x" }] },
          finish_reason: null,
        }),
      ),
    );

    const response = await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
    );

    expect(response.finishReason).toBe("unknown");
  });

  it("reads usage reported under meta when usage is absent", async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(
        chatReply({
          usage: undefined,
          meta: { tokens: { input_tokens: 7, output_tokens: 2 } },
        }),
      ),
    );

    const response = await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
    );

    expect(response.usage.inputTokens.total).toBe(7);
    expect(response.usage.outputTokens.total).toBe(2);
  });
});

// ── Streaming ─────────────────────────────────────────────────────────

describe("CohereLanguageModel.streamText", () => {
  it("emits bracketed text parts and a finish part from an SSE stream", async () => {
    const { fetch } = makeFetch(() =>
      sseResponse([
        { type: "message-start", id: "s1", delta: { message: { role: "assistant" } } },
        { type: "content-start", index: 0, delta: { message: { content: { type: "text", text: "" } } } },
        { type: "content-delta", index: 0, delta: { message: { content: { text: "Hello" } } } },
        { type: "content-delta", index: 0, delta: { message: { content: { text: " world" } } } },
        { type: "content-end", index: 0 },
        {
          type: "message-end",
          delta: { finish_reason: "COMPLETE", usage: { tokens: { input_tokens: 3, output_tokens: 2 } } },
        },
      ]),
    );

    const parts = await runTest(
      LanguageModel.streamText({ prompt: "greet" }).pipe(
        Stream.runCollect,
        Effect.provide(modelLayer(fetch)),
      ),
    );

    const types = parts.map((part) => part.type);
    expect(types[0]).toBe("response-metadata");
    expect(types).toContain("text-start");
    expect(types).toContain("text-end");

    const text = parts
      .filter((part) => part.type === "text-delta")
      .map((part) => (part as { delta: string }).delta)
      .join("");
    expect(text).toBe("Hello world");

    const finish = parts.find((part) => part.type === "finish");
    expect(finish).toBeDefined();
    expect((finish as { reason?: string } | undefined)?.reason).toBe("stop");
  });

  it("assembles a streamed tool call across events", async () => {
    const { fetch } = makeFetch(() =>
      sseResponse([
        { type: "message-start", id: "s2", delta: { message: { role: "assistant" } } },
        { type: "tool-plan-delta", delta: { message: { tool_plan: "I will check." } } },
        {
          type: "tool-call-start",
          index: 0,
          delta: {
            message: {
              tool_calls: { id: "call_5", type: "function", function: { name: "get_weather", arguments: "" } },
            },
          },
        },
        {
          type: "tool-call-delta",
          index: 0,
          delta: { message: { tool_calls: { function: { arguments: '{"ci' } } } },
        },
        {
          type: "tool-call-delta",
          index: 0,
          delta: { message: { tool_calls: { function: { arguments: 'ty":"Nice"}' } } } },
        },
        { type: "tool-call-end", index: 0 },
        { type: "message-end", delta: { finish_reason: "TOOL_CALL" } },
      ]),
    );

    const parts = await runTest(
      LanguageModel.streamText({
        prompt: "weather",
        toolkit: weatherToolkit,
        disableToolCallResolution: true,
      }).pipe(Stream.runCollect, Effect.provide(modelLayer(fetch)), Effect.provide(weatherHandlers)),
    );

    const types = parts.map((part) => part.type);
    expect(types).toContain("tool-params-start");
    expect(types).toContain("tool-params-end");

    const toolCall = parts.find((part) => part.type === "tool-call");
    expect(toolCall).toBeDefined();
    expect((toolCall as { params?: unknown } | undefined)?.params).toEqual({ city: "Nice" });
    expect((toolCall as { name?: string } | undefined)?.name).toBe("get_weather");
  });

  it("fails the stream when an event frame is not valid JSON", async () => {
    const { fetch } = makeFetch(() => sseResponse(["this is not json"]));

    await expectFailureInstanceOf(
      LanguageModel.streamText({ prompt: "hi" }).pipe(
        Stream.runCollect,
        Effect.provide(modelLayer(fetch)),
      ),
      AiError.AiError,
    );
  });

  it("maps an SSE framing failure (an event over the decoder's size cap) to an InvalidOutputError", async () => {
    // One `data:` line one code unit past `Sse.decode()`'s default 10 MiB
    // `maxEventSize`, never terminated by a blank line: the decoder fails with
    // `Sse.SseError` (`EventTooLarge`), which must surface as an `AiError`,
    // never as a raw transport error.
    const oversized = `data: ${"x".repeat(10 * 1024 * 1024)}\n`;
    const { fetch } = makeFetch(
      () =>
        new Response(oversized, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const error = await expectFailureInstanceOf(
      LanguageModel.streamText({ prompt: "hi" }).pipe(
        Stream.runCollect,
        Effect.provide(modelLayer(fetch)),
      ),
      AiError.AiError,
    );

    expect(error.module).toBe("CohereClient");
    expect(error.method).toBe("chatStream");
    expect(error.reason).toBeInstanceOf(AiError.InvalidOutputError);
    expect(error.reason.message).toContain("exceeded the maximum size");
  });
});

// ── Embeddings ────────────────────────────────────────────────────────

const embedLayer = (fetch: typeof globalThis.fetch, options?: CohereEmbeddingModel.Options) =>
  CohereEmbeddingModel.layer(options ?? { inputType: "search_document" }).pipe(
    Layer.provide(clientLayer(fetch)),
  );

describe("CohereEmbeddingModel", () => {
  it("posts to /v2/embed with the pinned model and dimension, decoding vectors + usage", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse({
        embeddings: { float: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] },
        meta: { billed_units: { input_tokens: 4 } },
      }),
    );

    const response = await runTest(
      Effect.gen(function* () {
        const model = yield* EmbeddingModel.EmbeddingModel;
        return yield* model.embedMany(["alpha", "bravo"]);
      }).pipe(Effect.provide(embedLayer(fetch))),
    );

    expect(calls[0]?.url).toBe("https://api.cohere.com/v2/embed");
    expect(calls[0]?.body.model).toBe(CohereEmbeddingModel.EMBEDDING_MODEL);
    expect(calls[0]?.body.model).toBe("embed-v4.0");
    expect(calls[0]?.body.input_type).toBe("search_document");
    expect(calls[0]?.body.output_dimension).toBe(1024);
    expect(calls[0]?.body.output_dimension).toBe(CohereEmbeddingModel.EMBEDDING_DIMENSIONS);
    expect(calls[0]?.body.embedding_types).toEqual(["float"]);
    expect(calls[0]?.body.texts).toEqual(["alpha", "bravo"]);

    expect(response.embeddings.map((embed) => embed.vector)).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(response.usage.inputTokens).toBe(4);
  });

  it("honours an overridden input type, model, and output dimension", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse({ embeddings: { float: [[1, 2]] } }),
    );

    await runTest(
      Effect.gen(function* () {
        const model = yield* EmbeddingModel.EmbeddingModel;
        return yield* model.embedMany(["q"]);
      }).pipe(
        Effect.provide(
          embedLayer(fetch, { inputType: "search_query", model: "embed-english-v3.0", outputDimension: 512 }),
        ),
      ),
    );

    expect(calls[0]?.body.input_type).toBe("search_query");
    expect(calls[0]?.body.model).toBe("embed-english-v3.0");
    expect(calls[0]?.body.output_dimension).toBe(512);
  });

  it("maps a non-2xx embed status to an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse({ message: "bad" }, 400));

    await expectFailureInstanceOf(
      Effect.gen(function* () {
        const model = yield* EmbeddingModel.EmbeddingModel;
        return yield* model.embedMany(["x"]);
      }).pipe(Effect.provide(embedLayer(fetch))),
      AiError.AiError,
    );
  });
});

// ── Reranking ─────────────────────────────────────────────────────────

const rerankLayer = (fetch: typeof globalThis.fetch, options?: CohereRerankerModel.Options) =>
  CohereRerankerModel.layer(options).pipe(Layer.provide(clientLayer(fetch)));

describe("CohereRerankerModel", () => {
  it("posts to /v2/rerank with the pinned model and returns results sorted by relevance", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse({
        results: [
          { index: 0, relevance_score: 0.1 },
          { index: 2, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.5 },
        ],
        meta: { billed_units: { search_units: 1 } },
      }),
    );

    const response = await runTest(
      Effect.gen(function* () {
        const model = yield* RerankerModel.RerankerModel;
        return yield* model.rerank({
          query: "which is best?",
          documents: ["alpha", "bravo", "charlie"],
        });
      }).pipe(Effect.provide(rerankLayer(fetch))),
    );

    expect(calls[0]?.url).toBe("https://api.cohere.com/v2/rerank");
    expect(calls[0]?.body.model).toBe(CohereRerankerModel.RERANK_MODEL);
    expect(calls[0]?.body.model).toBe("rerank-v3.5");
    expect(calls[0]?.body.query).toBe("which is best?");
    expect(calls[0]?.body.documents).toEqual(["alpha", "bravo", "charlie"]);

    expect(response.results.map((result) => result.index)).toEqual([2, 1, 0]);
    expect(response.results[0]?.relevanceScore).toBe(0.9);
    expect(response.usage.inputTokens).toBe(1);
  });

  it("passes topN through as top_n", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse({ results: [{ index: 1, relevance_score: 0.8 }] }),
    );

    await runTest(
      Effect.gen(function* () {
        const model = yield* RerankerModel.RerankerModel;
        return yield* model.rerank({ query: "q", documents: ["a", "b", "c"], topN: 1 });
      }).pipe(Effect.provide(rerankLayer(fetch))),
    );

    expect(calls[0]?.body.top_n).toBe(1);
  });

  it("short-circuits an empty documents array without a request", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse({ results: [] }));

    const response = await runTest(
      Effect.gen(function* () {
        const model = yield* RerankerModel.RerankerModel;
        return yield* model.rerank({ query: "q", documents: [] });
      }).pipe(Effect.provide(rerankLayer(fetch))),
    );

    expect(response.results).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ── Classification (chat + structured output) ─────────────────────────

const classifierLayer = (fetch: typeof globalThis.fetch, options?: CohereClassifierModel.Options) =>
  CohereClassifierModel.layer(options).pipe(Layer.provide(clientLayer(fetch)));

describe("CohereClassifierModel", () => {
  it("classifies via Cohere chat + structured output over /v2/chat", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(
        chatReply({
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  classifications: [
                    {
                      classes: [
                        { label: "negative", score: 0.1 },
                        { label: "positive", score: 0.9 },
                      ],
                    },
                  ],
                }),
              },
            ],
          },
        }),
      ),
    );

    const response = await runTest(
      Effect.gen(function* () {
        const model = yield* ClassifierModel.ClassifierModel;
        return yield* model.classify({
          inputs: ["great product"],
          labels: ["positive", "negative"],
        });
      }).pipe(Effect.provide(classifierLayer(fetch))),
    );

    expect(calls[0]?.url).toBe("https://api.cohere.com/v2/chat");
    expect(calls[0]?.body.model).toBe(CohereClassifierModel.DEFAULT_MODEL);
    expect(calls[0]?.body.response_format?.type).toBe("json_object");
    // Deterministic labelling — temperature defaults to 0.
    expect(calls[0]?.body.temperature).toBe(0);

    expect(response.classifications[0]?.classes[0]).toEqual(
      new ClassifierModel.ClassScore({ label: "positive", score: 0.9 }),
    );
  });

  it("fails with AiError when the model returns a label outside the requested set", async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(
        chatReply({
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  classifications: [{ classes: [{ label: "bogus", score: 0.5 }] }],
                }),
              },
            ],
          },
        }),
      ),
    );

    await expectFailureInstanceOf(
      Effect.gen(function* () {
        const model = yield* ClassifierModel.ClassifierModel;
        return yield* model.classify({ inputs: ["x"], labels: ["a", "b"] });
      }).pipe(Effect.provide(classifierLayer(fetch))),
      AiError.AiError,
    );
  });

  it("short-circuits empty inputs without a request", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

    const response = await runTest(
      Effect.gen(function* () {
        const model = yield* ClassifierModel.ClassifierModel;
        return yield* model.classify({ inputs: [] });
      }).pipe(Effect.provide(classifierLayer(fetch))),
    );

    expect(response.classifications).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ── Client-level embed/rerank error mapping ───────────────────────────

describe("CohereClient", () => {
  it("maps an undecodable rerank body to an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse({ nonsense: true }));

    await expectFailureInstanceOf(
      Effect.gen(function* () {
        const client = yield* CohereClient.CohereClient;
        return yield* client.rerank({ model: "rerank-v3.5", query: "q", documents: ["a"] });
      }).pipe(Effect.provide(clientLayer(fetch))),
      AiError.AiError,
    );
  });
});
