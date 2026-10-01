/**
 * Unit tests for the ElevenLabs Effect AI provider (`src/ElevenLabsClient.ts`
 * and the three `effect-ai-ext` model implementations).
 *
 * The network is stubbed at `FetchHttpClient.Fetch` — the same technique the
 * mistral provider tests use. Each stub captures the outgoing request (URL,
 * `xi-api-key` header, `output_format` query, body) and returns a canned
 * ElevenLabs response: raw audio bytes, a chunked audio `ReadableStream`, or a
 * Scribe JSON transcript, so the tests exercise request construction, the
 * binary/streaming/multipart paths, and response mapping without the network.
 *
 * Two behaviours specific to this streaming-audio provider are proven
 * directly:
 *   - **backpressure** — a pull-counting `ReadableStream` shows that consuming
 *     only part of a TTS stream does not drain the whole HTTP body;
 *   - **interruption** — interrupting the consuming Effect aborts the in-flight
 *     request (its `AbortSignal` fires) and cancels the response body stream.
 *
 * @module tests/elevenlabs
 */

import { describe, expect, it } from "vitest";
import { SpeechModel, TranscriptionModel, VoiceConversionModel } from "@thomasfosterau/effect-ai-ext";
import * as Config from "effect/Config";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { AiError } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import {
  ElevenLabsClient,
  ElevenLabsSpeechModel,
  ElevenLabsTranscriptionModel,
  ElevenLabsVoiceConversionModel,
} from "@thomasfosterau/effect-ai-elevenlabs";
import { expectFailureInstanceOf, runTest } from "./helpers/effect";

// ── Fetch stubbing ────────────────────────────────────────────────────

interface Captured {
  readonly url: string;
  readonly method: string;
  readonly apiKey: string | null;
  readonly contentType: string | null;
  readonly outputFormat: string | null;
  readonly request: Request;
  readonly signal: AbortSignal | null;
}

const makeFetch = (respond: (captured: Captured) => Response) => {
  const calls: Array<Captured> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const captured: Captured = {
      url: request.url,
      method: request.method,
      apiKey: request.headers.get("xi-api-key"),
      contentType: request.headers.get("content-type"),
      outputFormat: url.searchParams.get("output_format"),
      request: request.clone(),
      signal: init?.signal ?? null,
    };
    calls.push(captured);
    return respond(captured);
  };
  return { calls, fetch };
};

const httpLayer = (fetch: typeof globalThis.fetch) =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)));

// `null` omits the content-type header entirely (undici adds none for a byte body).
const audioResponse = (bytes: Uint8Array, contentType: string | null = "audio/mpeg"): Response =>
  new Response(bytes as BodyInit, {
    status: 200,
    headers: contentType === null ? {} : { "content-type": contentType },
  });

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const bytes = (...values: ReadonlyArray<number>): Uint8Array => Uint8Array.from(values);

// ── Layers ────────────────────────────────────────────────────────────

const clientLayer = (fetch: typeof globalThis.fetch, apiKey: string | undefined = "test-key") =>
  ElevenLabsClient.layer({
    apiKey: apiKey === undefined ? undefined : Redacted.make(apiKey),
  }).pipe(Layer.provide(httpLayer(fetch)));

const speechLayer = (fetch: typeof globalThis.fetch, settings?: ElevenLabsSpeechModel.Settings) =>
  ElevenLabsSpeechModel.layer(settings).pipe(Layer.provide(clientLayer(fetch)));

const transcriptionLayer = (
  fetch: typeof globalThis.fetch,
  settings?: ElevenLabsTranscriptionModel.Settings,
) => ElevenLabsTranscriptionModel.layer(settings).pipe(Layer.provide(clientLayer(fetch)));

const voiceConversionLayer = (
  fetch: typeof globalThis.fetch,
  settings?: ElevenLabsVoiceConversionModel.Settings,
) => ElevenLabsVoiceConversionModel.layer(settings).pipe(Layer.provide(clientLayer(fetch)));

const generate = (
  fetch: typeof globalThis.fetch,
  options: SpeechModel.SpeechOptions,
  settings?: ElevenLabsSpeechModel.Settings,
) =>
  runTest(
    Effect.flatMap(SpeechModel.SpeechModel, (model) => model.generate(options)).pipe(
      Effect.provide(speechLayer(fetch, settings)),
    ),
  );

// ── Text-to-speech (one-shot) ─────────────────────────────────────────

describe("ElevenLabsSpeechModel.generate", () => {
  it("posts to the text-to-speech endpoint with xi-api-key and decodes the audio", async () => {
    const { calls, fetch } = makeFetch(() => audioResponse(bytes(1, 2, 3, 4)));

    const response = await generate(
      fetch,
      { text: "hello world" },
      { voiceId: "voice_1", modelId: "eleven_multilingual_v2" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice_1");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.apiKey).toBe("test-key");

    const body = (await calls[0]!.request.json()) as Record<string, unknown>;
    expect(body.text).toBe("hello world");
    expect(body.model_id).toBe("eleven_multilingual_v2");

    expect(Array.from(response.audio)).toEqual([1, 2, 3, 4]);
    expect(response.mediaType).toBe("audio/mpeg");
    expect(response.usage.inputCharacters).toBe("hello world".length);
  });

  it("sends voice settings and a per-call voice override", async () => {
    const { calls, fetch } = makeFetch(() => audioResponse(bytes(9)));

    await generate(
      fetch,
      { text: "hi", voice: "override_voice" },
      { voiceId: "default_voice", voiceSettings: { stability: 0.4, similarity_boost: 0.8 } },
    );

    expect(calls[0]?.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/override_voice");
    const body = (await calls[0]!.request.json()) as { voice_settings?: Record<string, number> };
    expect(body.voice_settings).toEqual({ stability: 0.4, similarity_boost: 0.8 });
  });

  it("derives output_format from neutral format + sampleRate and its media type", async () => {
    const { calls, fetch } = makeFetch(() => audioResponse(bytes(1), null));

    const response = await generate(
      fetch,
      { text: "hi", format: "pcm", sampleRate: 24000 },
      { voiceId: "voice_1" },
    );

    expect(calls[0]?.outputFormat).toBe("pcm_24000");
    // No content-type header on the response → media type derived from format.
    expect(response.mediaType).toBe("audio/pcm");
  });

  it("passes an explicit model output_format through unchanged", async () => {
    const { calls, fetch } = makeFetch(() => audioResponse(bytes(1)));

    await generate(fetch, { text: "hi" }, { voiceId: "v", outputFormat: "mp3_22050_32" });

    expect(calls[0]?.outputFormat).toBe("mp3_22050_32");
  });

  it("fails with an AiError when no voice id is available", async () => {
    const { fetch } = makeFetch(() => audioResponse(bytes(1)));

    await expectFailureInstanceOf(
      Effect.flatMap(SpeechModel.SpeechModel, (model) => model.generate({ text: "hi" })).pipe(
        Effect.provide(speechLayer(fetch)),
      ),
      AiError.AiError,
    );
  });

  it("maps a non-2xx status to an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse({ detail: "rate limited" }, 429));

    await expectFailureInstanceOf(
      Effect.flatMap(SpeechModel.SpeechModel, (model) => model.generate({ text: "hi", voice: "v" })).pipe(
        Effect.provide(speechLayer(fetch)),
      ),
      AiError.AiError,
    );
  });

  it("rejects an empty audio buffer via the abstraction's validation", async () => {
    const { fetch } = makeFetch(() => audioResponse(new Uint8Array(0)));

    await expectFailureInstanceOf(
      Effect.flatMap(SpeechModel.SpeechModel, (model) => model.generate({ text: "hi", voice: "v" })).pipe(
        Effect.provide(speechLayer(fetch)),
      ),
      AiError.AiError,
    );
  });

  it("omits the xi-api-key header when constructed without a key", async () => {
    const { calls, fetch } = makeFetch(() => audioResponse(bytes(1)));

    const keylessClient = ElevenLabsClient.layer({}).pipe(Layer.provide(httpLayer(fetch)));

    await runTest(
      Effect.flatMap(SpeechModel.SpeechModel, (model) => model.generate({ text: "hi", voice: "v" })).pipe(
        Effect.provide(ElevenLabsSpeechModel.layer().pipe(Layer.provide(keylessClient))),
      ),
    );

    expect(calls[0]?.apiKey).toBeNull();
  });
});

// ── Text-to-speech (streaming) ────────────────────────────────────────

/**
 * A pull-based audio `ReadableStream` that enqueues one chunk per consumer
 * pull and records how many pulls happened and whether it was cancelled — the
 * instrument for the backpressure and interruption assertions.
 */
const makeChunkedStream = (chunks: ReadonlyArray<Uint8Array>) => {
  const state = { pulled: 0, cancelled: false };
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      if (index < chunks.length) {
        controller.enqueue(chunks[index]!);
        index += 1;
      } else {
        controller.close();
      }
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { body, state };
};

describe("ElevenLabsSpeechModel.stream", () => {
  it("posts to the /stream endpoint and yields the audio as multiple chunks", async () => {
    const chunks = [bytes(1, 1), bytes(2, 2), bytes(3, 3)];
    const { body } = makeChunkedStream(chunks);
    const { calls, fetch } = makeFetch(() =>
      new Response(body, { status: 200, headers: { "content-type": "audio/mpeg" } }),
    );

    const received = await runTest(
      Effect.flatMap(SpeechModel.SpeechModel, (model) =>
        Stream.runCollect(model.stream({ text: "hi", voice: "v" })),
      ).pipe(Effect.provide(speechLayer(fetch))),
    );

    expect(calls[0]?.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/v/stream");
    // Proven multiple chunks (not one coalesced buffer).
    expect(received.length).toBeGreaterThanOrEqual(2);
    const flat = received.flatMap((chunk) => Array.from(chunk));
    expect(flat).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("respects backpressure — a partial consumer does not drain the whole body", async () => {
    const chunks = Array.from({ length: 8 }, (_, i) => bytes(i));
    const { body, state } = makeChunkedStream(chunks);
    const { fetch } = makeFetch(() =>
      new Response(body, { status: 200, headers: { "content-type": "audio/mpeg" } }),
    );

    const received = await runTest(
      Effect.flatMap(SpeechModel.SpeechModel, (model) =>
        Stream.runCollect(Stream.take(model.stream({ text: "hi", voice: "v" }), 2)),
      ).pipe(Effect.provide(speechLayer(fetch))),
    );

    expect(received.length).toBe(2);
    // The source was never fully pulled: backpressure held, no unbounded buffering.
    expect(state.pulled).toBeLessThan(chunks.length);
    // Ending consumption early cancelled the underlying HTTP body stream.
    expect(state.cancelled).toBe(true);
  });

  it("aborts the in-flight HTTP stream when the consuming Effect is interrupted", async () => {
    const state = { pulled: 0, cancelled: false };
    const first = bytes(7, 7, 7);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.pulled += 1;
        if (state.pulled === 1) {
          controller.enqueue(first);
          return;
        }
        // Keep the body open indefinitely so the consumer blocks until interrupted.
        return new Promise<void>(() => {});
      },
      cancel() {
        state.cancelled = true;
      },
    });
    const { calls, fetch } = makeFetch(() =>
      new Response(body, { status: 200, headers: { "content-type": "audio/mpeg" } }),
    );

    const signal = await runTest(
      Effect.gen(function* () {
        const latch = yield* Deferred.make<void>();
        const model = yield* SpeechModel.SpeechModel;
        const fiber = yield* Effect.forkChild(
          model.stream({ text: "hi", voice: "v" }).pipe(
            Stream.tap(() => Deferred.succeed(latch, undefined)),
            Stream.runDrain,
          ),
        );
        yield* Deferred.await(latch);
        yield* Fiber.interrupt(fiber);
        return calls[0]?.signal ?? null;
      }).pipe(Effect.provide(speechLayer(fetch))),
    );

    // Interrupting the Effect aborted the in-flight HTTP request…
    expect(signal?.aborted).toBe(true);
    // …and cancelled the response body stream.
    expect(state.cancelled).toBe(true);
  });
});

// ── Speech-to-text (Scribe) ───────────────────────────────────────────

const scribeResponse = (over?: Record<string, unknown>) => ({
  language_code: "en",
  language_probability: 0.99,
  text: "hello world",
  words: [
    { text: "hello", start: 0, end: 0.5, type: "word" },
    { text: " ", start: 0.5, end: 0.5, type: "spacing" },
    { text: "world", start: 0.5, end: 1.0, type: "word" },
  ],
  ...over,
});

describe("ElevenLabsTranscriptionModel.transcribe", () => {
  it("uploads audio as multipart and maps the transcript, segments and language", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(scribeResponse()));

    const response = await runTest(
      Effect.flatMap(TranscriptionModel.TranscriptionModel, (model) =>
        model.transcribe({ audio: bytes(1, 2, 3), mediaType: "audio/mpeg" }),
      ).pipe(Effect.provide(transcriptionLayer(fetch))),
    );

    expect(calls[0]?.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(calls[0]?.apiKey).toBe("test-key");
    expect(calls[0]?.contentType).toMatch(/^multipart\/form-data/);

    const form = await calls[0]!.request.formData();
    expect(form.get("model_id")).toBe("scribe_v1");
    expect(form.get("file")).toBeInstanceOf(Blob);

    expect(response.text).toBe("hello world");
    expect(response.language).toBe("en");
    // Only spoken `word` tokens become segments (the spacing token is dropped).
    expect(response.segments?.map((segment) => segment.text)).toEqual(["hello", "world"]);
    expect(response.segments?.[0]).toMatchObject({ start: 0, end: 0.5 });
    expect(response.usage.durationSeconds).toBe(1.0);
  });

  it("collects a streamed audio input into the upload", async () => {
    const { calls, fetch } = makeFetch(() => jsonResponse(scribeResponse()));

    const audio = Stream.fromIterable([bytes(1, 2), bytes(3, 4)]);

    await runTest(
      Effect.flatMap(TranscriptionModel.TranscriptionModel, (model) =>
        model.transcribe({ audio, language: "fr" }),
      ).pipe(Effect.provide(transcriptionLayer(fetch))),
    );

    const form = await calls[0]!.request.formData();
    const file = form.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(await file.arrayBuffer().then((b) => Array.from(new Uint8Array(b)))).toEqual([1, 2, 3, 4]);
    // The per-call language overrides the model default.
    expect(form.get("language_code")).toBe("fr");
  });

  it("maps a non-2xx status to an AiError", async () => {
    const { fetch } = makeFetch(() => jsonResponse({ detail: "bad audio" }, 422));

    await expectFailureInstanceOf(
      Effect.flatMap(TranscriptionModel.TranscriptionModel, (model) =>
        model.transcribe({ audio: bytes(1) }),
      ).pipe(Effect.provide(transcriptionLayer(fetch))),
      AiError.AiError,
    );
  });
});

// ── Speech-to-speech (voice conversion) ───────────────────────────────

describe("ElevenLabsVoiceConversionModel.convert", () => {
  it("uploads source audio as multipart and returns the re-voiced audio", async () => {
    const { calls, fetch } = makeFetch(() => audioResponse(bytes(5, 6, 7)));

    const response = await runTest(
      Effect.flatMap(VoiceConversionModel.VoiceConversionModel, (model) =>
        model.convert({ audio: bytes(1, 2), targetVoice: "target_voice" }),
      ).pipe(
        Effect.provide(voiceConversionLayer(fetch, { modelId: "eleven_multilingual_sts_v2" })),
      ),
    );

    expect(calls[0]?.url).toBe("https://api.elevenlabs.io/v1/speech-to-speech/target_voice");
    expect(calls[0]?.apiKey).toBe("test-key");
    expect(calls[0]?.contentType).toMatch(/^multipart\/form-data/);

    const form = await calls[0]!.request.formData();
    expect(form.get("model_id")).toBe("eleven_multilingual_sts_v2");
    expect(form.get("audio")).toBeInstanceOf(Blob);

    expect(Array.from(response.audio)).toEqual([5, 6, 7]);
    expect(response.mediaType).toBe("audio/mpeg");
  });

  it("threads an explicit output_format query and encodes voice settings", async () => {
    const { calls, fetch } = makeFetch(() => audioResponse(bytes(1)));

    await runTest(
      Effect.flatMap(VoiceConversionModel.VoiceConversionModel, (model) =>
        model.convert({ audio: bytes(1), targetVoice: "v", format: "mp3_44100_128" }),
      ).pipe(
        Effect.provide(voiceConversionLayer(fetch, { voiceSettings: { stability: 0.3 } })),
      ),
    );

    expect(calls[0]?.outputFormat).toBe("mp3_44100_128");
    const form = await calls[0]!.request.formData();
    expect(form.get("voice_settings")).toBe(JSON.stringify({ stability: 0.3 }));
  });
});

// ── Client — BYOK routing and middleware ──────────────────────────────

describe("ElevenLabsClient", () => {
  it("routes through the apiUrl override (BYOK) from a Config-driven layer", async () => {
    const { calls, fetch } = makeFetch(() => audioResponse(bytes(1)));

    const client = ElevenLabsClient.layerConfig({
      apiKey: Config.succeed(Redacted.make("cfg-key")),
      apiUrl: Config.succeed("https://gateway.example/eleven"),
    }).pipe(Layer.provide(httpLayer(fetch)));

    await runTest(
      Effect.flatMap(SpeechModel.SpeechModel, (model) => model.generate({ text: "hi", voice: "v" })).pipe(
        Effect.provide(ElevenLabsSpeechModel.layer().pipe(Layer.provide(client))),
      ),
    );

    expect(calls[0]?.url).toBe("https://gateway.example/eleven/v1/text-to-speech/v");
    expect(calls[0]?.apiKey).toBe("cfg-key");
  });

  it("applies a transformClient to outgoing requests", async () => {
    const { calls, fetch } = makeFetch(() => audioResponse(bytes(1)));

    const client = ElevenLabsClient.layer({
      apiKey: Redacted.make("k"),
      transformClient: (httpClient) =>
        HttpClient.mapRequest(httpClient, HttpClientRequest.setHeader("x-test", "1")),
    }).pipe(Layer.provide(httpLayer(fetch)));

    await runTest(
      Effect.flatMap(SpeechModel.SpeechModel, (model) => model.generate({ text: "hi", voice: "v" })).pipe(
        Effect.provide(ElevenLabsSpeechModel.layer().pipe(Layer.provide(client))),
      ),
    );

    expect(calls[0]?.request.headers.get("x-test")).toBe("1");
  });

  it("maps a transport failure to an AiError", async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new TypeError("network down");
    };

    await expectFailureInstanceOf(
      Effect.flatMap(SpeechModel.SpeechModel, (model) => model.generate({ text: "hi", voice: "v" })).pipe(
        Effect.provide(speechLayer(fetch)),
      ),
      AiError.AiError,
    );
  });
});
