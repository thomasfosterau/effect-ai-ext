/**
 * Unit tests for the custom Mistral Effect AI provider (`src/MistralClient.ts`
 * and `src/MistralLanguageModel.ts`).
 *
 * The network is stubbed at `FetchHttpClient.Fetch` — the same technique the
 * gateway package's provider tests use. Each stub captures the outgoing
 * request (URL, `authorization` header, JSON body) and returns a canned
 * Mistral chat-completions response (or an SSE stream), so the tests exercise
 * request construction, prompt / tool / structured-output conversion, and
 * response decoding without reaching the network.
 *
 * @module tests/mistral
 */

import { describe, expect, it } from "vitest";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AiError, LanguageModel, Tool, Toolkit } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { MistralClient, MistralLanguageModel } from "@thomasfosterau/effect-ai-mistral";
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
  readonly response_format?: {
    readonly type?: string;
    readonly json_schema?: { readonly name?: string };
  };
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

const sseResponse = (frames: ReadonlyArray<unknown>): Response => {
  const text =
    frames
      .map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`)
      .join("") + "data: [DONE]\n\n";
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const completion = (over?: Record<string, unknown>) => ({
  id: "cmpl_1",
  object: "chat.completion",
  model: "mistral-large-latest",
  created: 1,
  choices: [
    { index: 0, message: { role: "assistant", content: "Bonjour" }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  ...over,
});

const modelLayer = (
  fetch: typeof globalThis.fetch,
  options?: {
    readonly apiKey?: Redacted.Redacted<string>;
    readonly config?: Omit<MistralLanguageModel.ConfigService, "model">;
  },
) =>
  MistralLanguageModel.layer({ model: "mistral-large-latest", config: options?.config }).pipe(
    Layer.provide(
      MistralClient.layer({
        apiKey: options?.apiKey ?? Redacted.make("test-key"),
      }),
    ),
    Layer.provide(httpLayer(fetch)),
  );

// ── Text generation ───────────────────────────────────────────────────

describe("MistralLanguageModel.generateText", () => {
  it("posts to the chat-completions endpoint with a bearer token and decodes the reply", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    const response = await runTest(
      LanguageModel.generateText({ prompt: "dis bonjour" }).pipe(Effect.provide(modelLayer(fetch))),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(calls[0]?.authorization).toBe("Bearer test-key");
    expect(calls[0]?.body.model).toBe("mistral-large-latest");
    expect(calls[0]?.body.stream).toBe(false);
    expect(response.text).toBe("Bonjour");
    expect(response.usage.inputTokens.total).toBe(10);
    expect(response.usage.outputTokens.total).toBe(3);
    expect(response.finishReason).toBe("stop");
  });

  it("omits the authorization header when constructed without an API key", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(
          MistralLanguageModel.layer({ model: "mistral-small-latest" }).pipe(
            Layer.provide(MistralClient.layer({})),
            Layer.provide(httpLayer(fetch)),
          ),
        ),
      ),
    );

    expect(calls[0]?.authorization).toBeNull();
  });

  it("translates each prompt message into its Mistral wire form", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

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
      name: "get_weather",
      content: '{"temp":20}',
    });
  });

  it("collapses a text-only user message into a plain string", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    await runTest(
      LanguageModel.generateText({ prompt: "just text" }).pipe(Effect.provide(modelLayer(fetch))),
    );

    expect(calls[0]?.body.messages?.[0]).toEqual({ role: "user", content: "just text" });
  });

  it("rejects unsupported (non-image) file parts with an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse(completion()));

    await expectFailureInstanceOf(
      LanguageModel.generateText({
        prompt: [
          {
            role: "user",
            content: [{ type: "file", mediaType: "application/zip", data: "AAAA" }],
          },
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
    const { fetch } = makeFetch(() => jsonResponse({ not: "a completion" }));

    await expectFailureInstanceOf(
      LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
      AiError.AiError,
    );
  });
});

// ── Configuration ─────────────────────────────────────────────────────

describe("MistralLanguageModel configuration", () => {
  it("threads construction-time config into the request", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(modelLayer(fetch, { config: { temperature: 0.2, maxTokens: 128 } })),
      ),
    );

    expect(calls[0]?.body.temperature).toBe(0.2);
  });

  it("lets withConfigOverride win over construction-time config", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        MistralLanguageModel.withConfigOverride({ temperature: 0.9 }),
        Effect.provide(modelLayer(fetch, { config: { temperature: 0.2 } })),
      ),
    );

    expect(calls[0]?.body.temperature).toBe(0.9);
  });

  it("provides the model through a Config-driven client layer", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    const clientLayer = MistralClient.layerConfig({
      apiKey: Config.succeed(Redacted.make("cfg-key")),
      apiUrl: Config.succeed("https://proxy.example"),
    });

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(
          MistralLanguageModel.layer({ model: "ministral-8b-latest" }).pipe(
            Layer.provide(clientLayer),
            Layer.provide(httpLayer(fetch)),
          ),
        ),
      ),
    );

    expect(calls[0]?.url).toBe("https://proxy.example/v1/chat/completions");
    expect(calls[0]?.authorization).toBe("Bearer cfg-key");
  });
});

// ── Structured output ─────────────────────────────────────────────────

describe("MistralLanguageModel.generateObject", () => {
  it("requests a json_schema response format and decodes the object", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(
        completion({
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: JSON.stringify({ city: "Paris" }) },
              finish_reason: "stop",
            },
          ],
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

    expect(calls[0]?.body.response_format?.type).toBe("json_schema");
    expect(calls[0]?.body.response_format?.json_schema?.name).toBe("city_result");
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

describe("MistralLanguageModel tool calling", () => {
  it("sends tool definitions and resolves the model's tool call", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(
        completion({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_9",
                    type: "function",
                    function: { name: "get_weather", arguments: '{"city":"Paris"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      ),
    );

    const response = await runTest(
      LanguageModel.generateText({ prompt: "weather in Paris?", toolkit: weatherToolkit }).pipe(
        Effect.provide(modelLayer(fetch)),
        Effect.provide(weatherHandlers),
      ),
    );

    const tools = calls[0]?.body.tools ?? [];
    expect((tools[0] as { function?: { name?: string } })?.function?.name).toBe("get_weather");
    expect(calls[0]?.body.tool_choice).toBe("auto");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolResults[0]?.result).toBe("sunny in Paris");
  });

  it('maps a required tool choice to Mistral\'s "any"', async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(
        completion({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "get_weather", arguments: '{"city":"Lyon"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      ),
    );

    await runTest(
      LanguageModel.generateText({
        prompt: "weather?",
        toolkit: weatherToolkit,
        toolChoice: "required",
      }).pipe(Effect.provide(modelLayer(fetch)), Effect.provide(weatherHandlers)),
    );

    expect(calls[0]?.body.tool_choice).toBe("any");
  });
});

// ── Streaming ─────────────────────────────────────────────────────────

describe("MistralLanguageModel.streamText", () => {
  it("emits bracketed text parts and a finish part from an SSE stream", async () => {
    const { fetch } = makeFetch(() =>
      sseResponse([
        {
          id: "s1",
          model: "mistral-large-latest",
          choices: [{ index: 0, delta: { role: "assistant", content: "Hello" } }],
        },
        {
          id: "s1",
          model: "mistral-large-latest",
          choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
        },
        {
          id: "s1",
          model: "mistral-large-latest",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
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

  it("assembles a streamed tool call across chunks", async () => {
    const { fetch } = makeFetch(() =>
      sseResponse([
        {
          id: "s2",
          model: "mistral-large-latest",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: "call_5", function: { name: "get_weather", arguments: '{"ci' } },
                ],
              },
            },
          ],
        },
        {
          id: "s2",
          model: "mistral-large-latest",
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"Nice"}' } }] },
            },
          ],
        },
        {
          id: "s2",
          model: "mistral-large-latest",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        },
      ]),
    );

    const parts = await runTest(
      LanguageModel.streamText({
        prompt: "weather",
        toolkit: weatherToolkit,
        disableToolCallResolution: true,
      }).pipe(
        Stream.runCollect,
        Effect.provide(modelLayer(fetch)),
        Effect.provide(weatherHandlers),
      ),
    );

    const types = parts.map((part) => part.type);
    expect(types).toContain("tool-params-start");
    expect(types).toContain("tool-params-end");

    const toolCall = parts.find((part) => part.type === "tool-call");
    expect(toolCall).toBeDefined();
    expect((toolCall as { params?: unknown } | undefined)?.params).toEqual({ city: "Nice" });
  });

  it("finishes a stream that ends with a usage-only chunk", async () => {
    const { fetch } = makeFetch(() =>
      sseResponse([
        {
          id: "s3",
          model: "mistral-large-latest",
          choices: [{ index: 0, delta: { content: "hi" } }],
        },
        {
          id: "s3",
          model: "mistral-large-latest",
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      ]),
    );

    const parts = await runTest(
      LanguageModel.streamText({ prompt: "hi" }).pipe(
        Stream.runCollect,
        Effect.provide(modelLayer(fetch)),
      ),
    );

    expect(parts.some((part) => part.type === "finish")).toBe(true);
  });
});

// ── Additional request / conversion coverage ──────────────────────────

describe("MistralLanguageModel request construction", () => {
  it("threads every tunable config field into the request body", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(
          modelLayer(fetch, {
            config: {
              temperature: 0.1,
              topP: 0.9,
              maxTokens: 64,
              randomSeed: 7,
              stop: ["STOP"],
              presencePenalty: 0.5,
              frequencyPenalty: 0.25,
            },
          }),
        ),
      ),
    );

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.top_p).toBe(0.9);
    expect(body.max_tokens).toBe(64);
    expect(body.random_seed).toBe(7);
    expect(body.stop).toEqual(["STOP"]);
    expect(body.presence_penalty).toBe(0.5);
    expect(body.frequency_penalty).toBe(0.25);
  });

  it("encodes image file parts from a URL object, an http URL, and raw base64", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    await runTest(
      LanguageModel.generateText({
        prompt: [
          {
            role: "user",
            content: [
              { type: "file", mediaType: "image/*", data: new URL("https://img.example/a.png") },
              { type: "file", mediaType: "image/png", data: "https://img.example/b.png" },
              { type: "file", mediaType: "image/jpeg", data: "QUJD" },
            ],
          },
        ],
      }).pipe(Effect.provide(modelLayer(fetch))),
    );

    const message = calls[0]?.body.messages?.[0] as
      | { content: Array<{ image_url: { url: string } }> }
      | undefined;
    const content = message?.content ?? [];
    expect(content[0]?.image_url.url).toBe("https://img.example/a.png");
    expect(content[1]?.image_url.url).toBe("https://img.example/b.png");
    expect(content[2]?.image_url.url).toBe("data:image/jpeg;base64,QUJD");
  });

  it("emits a content-less assistant message and drops provider-executed tool calls", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    await runTest(
      LanguageModel.generateText({
        prompt: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                id: "call_a",
                name: "get_weather",
                params: { city: "Rome" },
                providerExecuted: false,
              },
              {
                type: "tool-call",
                id: "call_b",
                name: "search",
                params: {},
                providerExecuted: true,
              },
            ],
          },
          { role: "user", content: "and now?" },
        ],
      }).pipe(Effect.provide(modelLayer(fetch))),
    );

    const assistant = calls[0]?.body.messages?.[0] as {
      content: unknown;
      tool_calls: Array<{ id: string }>;
    };
    expect(assistant.content).toBeNull();
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls[0]?.id).toBe("call_a");
  });

  it("pins a specific tool via a { tool } choice", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(
        completion({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "get_weather", arguments: '{"city":"Metz"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      ),
    );

    await runTest(
      LanguageModel.generateText({
        prompt: "weather?",
        toolkit: weatherToolkit,
        toolChoice: { tool: "get_weather" },
      }).pipe(Effect.provide(modelLayer(fetch)), Effect.provide(weatherHandlers)),
    );

    expect(calls[0]?.body.tool_choice).toEqual({
      type: "function",
      function: { name: "get_weather" },
    });
  });

  it("restricts tools to a required oneOf subset", async () => {
    const { calls, fetch } = makeFetch(() =>
      jsonResponse(
        completion({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "get_weather", arguments: '{"city":"Metz"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      ),
    );

    await runTest(
      LanguageModel.generateText({
        prompt: "weather?",
        toolkit: weatherToolkit,
        toolChoice: { mode: "required", oneOf: ["get_weather"] },
      }).pipe(Effect.provide(modelLayer(fetch)), Effect.provide(weatherHandlers)),
    );

    expect(calls[0]?.body.tool_choice).toBe("any");
    expect(calls[0]?.body.tools).toHaveLength(1);
  });
});

describe("MistralLanguageModel finish reasons", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["content_filter", "content-filter"],
    ["model_length", "length"],
    ["something_new", "other"],
  ];

  for (const [wire, expected] of cases) {
    it(`maps the "${wire}" finish reason to "${expected}"`, async () => {
      const { fetch } = makeFetch(() =>
        jsonResponse(
          completion({
            choices: [
              { index: 0, message: { role: "assistant", content: "x" }, finish_reason: wire },
            ],
          }),
        ),
      );

      const response = await runTest(
        LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
      );

      expect(response.finishReason).toBe(expected);
    });
  }
});

describe("MistralClient", () => {
  it("maps a transport failure to an AiError", async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new TypeError("network down");
    };

    await expectFailureInstanceOf(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(
          MistralLanguageModel.layer({ model: "mistral-small-latest" }).pipe(
            Layer.provide(MistralClient.layer({ apiKey: Redacted.make("k") })),
            Layer.provide(httpLayer(fetch)),
          ),
        ),
      ),
      AiError.AiError,
    );
  });

  it("applies a transformClient to outgoing requests", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provide(
          MistralLanguageModel.layer({ model: "mistral-small-latest" }).pipe(
            Layer.provide(
              MistralClient.layer({
                apiKey: Redacted.make("k"),
                transformClient: (client) =>
                  HttpClient.mapRequest(client, HttpClientRequest.setHeader("x-test", "1")),
              }),
            ),
            Layer.provide(httpLayer(fetch)),
          ),
        ),
      ),
    );

    expect(calls[0]?.headers["x-test"]).toBe("1");
  });
});

// ── Remaining branch coverage ─────────────────────────────────────────

describe("MistralLanguageModel response edge cases", () => {
  it("synthesises an id for a tool call the model returned without one", async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(
        completion({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    type: "function",
                    function: { name: "get_weather", arguments: '{"city":"Caen"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
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

  it("produces an unknown finish for a choiceless completion", async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(completion({ choices: [], usage: { prompt_tokens: 1 } })),
    );

    const response = await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
    );

    expect(response.finishReason).toBe("unknown");
  });

  it("maps a null finish reason to unknown", async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(
        completion({
          choices: [
            { index: 0, message: { role: "assistant", content: "x" }, finish_reason: null },
          ],
        }),
      ),
    );

    const response = await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
    );

    expect(response.finishReason).toBe("unknown");
  });

  it("maps the error finish reason", async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(
        completion({
          choices: [
            { index: 0, message: { role: "assistant", content: "x" }, finish_reason: "error" },
          ],
        }),
      ),
    );

    const response = await runTest(
      LanguageModel.generateText({ prompt: "hi" }).pipe(Effect.provide(modelLayer(fetch))),
    );

    expect(response.finishReason).toBe("error");
  });

  it("fails the stream when a chunk frame is not valid JSON", async () => {
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

    expect(error.module).toBe("MistralClient");
    expect(error.method).toBe("createChatCompletionStream");
    expect(error.reason).toBeInstanceOf(AiError.InvalidOutputError);
    expect(error.reason.message).toContain("exceeded the maximum size");
  });

  it("supports the data-first withConfigOverride form", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(completion()));

    const program = MistralLanguageModel.withConfigOverride(
      LanguageModel.generateText({ prompt: "hi" }),
      { temperature: 0.42 },
    );

    await runTest(program.pipe(Effect.provide(modelLayer(fetch))));

    expect(calls[0]?.body.temperature).toBe(0.42);
  });
});
