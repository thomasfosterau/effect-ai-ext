# @thomasfosterau/effect-ai-elevenlabs

An [Effect](https://effect.website) AI provider for **ElevenLabs** — the audio leg of the `@thomasfosterau/effect-ai-*` family. Effect ships no ElevenLabs package, so this implements [`@thomasfosterau/effect-ai-ext`](https://github.com/thomasfosterau/effect-ai-ext/tree/trunk/packages/effect-ai-ext)'s audio abstractions directly against the ElevenLabs API.

- **`ElevenLabsClient`** — the low-level HTTP client (binary and chunked streaming audio, multipart uploads), every failure mapped to `AiError`. Its `apiUrl` override is the BYOK contract used by a routing layer (the gateway), and the key is sent as the `xi-api-key` header.
- **`ElevenLabsSpeechModel`** — the `SpeechModel` (text-to-speech): a one-shot `generate` returning the full audio buffer, and a backpressured, interruption-safe `stream` of audio chunks.
- **`ElevenLabsTranscriptionModel`** — the `TranscriptionModel` over Scribe (speech-to-text) with per-word segment timestamps and detected language.
- **`ElevenLabsVoiceConversionModel`** — the `VoiceConversionModel` (speech-to-speech).

## Install

```sh
pnpm add @thomasfosterau/effect-ai-elevenlabs @thomasfosterau/effect-ai-ext effect
```

`effect` (`>=4.0.0-rc.118`) is a peer dependency: it must be a single copy across your app. `@thomasfosterau/effect-ai-ext` is a dependency, listed above because you import the service tags (`SpeechModel`, …) from it.

## Usage

```ts
import { Config, Effect, Layer, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { SpeechModel } from "@thomasfosterau/effect-ai-ext";
import { ElevenLabsClient, ElevenLabsSpeechModel } from "@thomasfosterau/effect-ai-elevenlabs";

const SpeechLayer = ElevenLabsSpeechModel.layer({
  voiceId: "21m00Tcm4TlvDq8ikWAM",
  modelId: "eleven_multilingual_v2",
}).pipe(
  Layer.provide(ElevenLabsClient.layerConfig({ apiKey: Config.Redacted("ELEVENLABS_API_KEY") })),
  Layer.provide(FetchHttpClient.layer),
);

// One-shot bytes:
const speak = Effect.flatMap(SpeechModel.SpeechModel, (model) =>
  model.generate({ text: "Hello from Effect" }),
).pipe(Effect.provide(SpeechLayer));

// Backpressured streaming — chunks are pulled on demand and the request is
// aborted if the consumer is interrupted; nothing is buffered whole:
const stream = Effect.flatMap(SpeechModel.SpeechModel, (model) =>
  Stream.runForEach(model.stream({ text: "Hello from Effect" }), (chunk) =>
    Effect.sync(() => process.stdout.write(chunk)),
  ),
).pipe(Effect.provide(SpeechLayer));
```

The neutral `format` / `sampleRate` speech options map onto ElevenLabs' combined `output_format` (e.g. `pcm` + `24000` → `pcm_24000`); pass a full ElevenLabs id via `outputFormat` (or a `format` that already contains an underscore) for exact control. Scribe transcription and speech-to-speech accept audio as bytes or a `Stream` (drained to the multipart upload those endpoints require).

## API

### `ElevenLabsClient`

The low-level HTTP client over an `HttpClient` from context. Its `Service` has `textToSpeech` and `textToSpeechStream` (`/v1/text-to-speech/{voice_id}`, the stream forwarding body chunks as they arrive), `speechToText` (Scribe, multipart) and `speechToSpeech` (multipart).

| Export | What it is |
| --- | --- |
| `ElevenLabsClient` | The `Context.Service` tag. |
| `make(options)` / `layer(options)` | The service, effectfully or as a `Layer` requiring `HttpClient`. |
| `layerConfig(options?)` | The same, each option read from a `Config` (`apiKey: Config<Redacted \| undefined>`, `apiUrl: Config<string>`); fails with `ConfigError`. |
| `defaultApiUrl` | `"https://api.elevenlabs.io"`. |

`Options`: `apiKey?: Redacted<string>` (sent as the `xi-api-key` header; omit it when a proxy injects the credential), `apiUrl?: string` (override it to point the client at a proxy or a gateway route for BYOK), `transformClient?: (client: HttpClient) => HttpClient`.

### `ElevenLabsSpeechModel`

A `SpeechModel`. `layer(settings?)` / `make(settings?)` take construction-time defaults, which a call's `voice` / `format` / `sampleRate` override:

- `voiceId?` — the default voice; a call with neither `voice` nor `voiceId` fails with an `AiError` (`InvalidUserInputError`).
- `modelId?` — e.g. `"eleven_multilingual_v2"` (`Model` lists the known ids).
- `outputFormat?` — an explicit ElevenLabs `output_format` (e.g. `"mp3_44100_128"`), winning over the call's `format` / `sampleRate`.
- `languageCode?`, `voiceSettings?`, `seed?`.

### `ElevenLabsTranscriptionModel`

A `TranscriptionModel` over Scribe. `layer(settings?)` / `make(settings?)` take `modelId?` (default `"scribe_v1"`), `languageCode?` (a call's `language` overrides it), `timestampsGranularity?` (`"word"` or `"character"`, default `"word"`), `diarize?` and `tagAudioEvents?`. Spoken words become `segments`; the detected language and the latest word end (as `usage.durationSeconds`) are reported.

### `ElevenLabsVoiceConversionModel`

A `VoiceConversionModel` (speech-to-speech) into the call's `targetVoice`. `layer(settings?)` / `make(settings?)` take `modelId?` (e.g. `"eleven_multilingual_sts_v2"`), `outputFormat?`, `voiceSettings?`, `removeBackgroundNoise?`, `seed?` and `inputMediaType?` (the uploaded audio's media type).

### Errors

Every transport, HTTP-status and decoding failure leaves the provider as an `AiError` from `effect/ai`, its reason derived from the HTTP status.

## License

MIT
