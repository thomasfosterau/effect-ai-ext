# @thomasfosterau/effect-ai-elevenlabs

An [Effect](https://effect.website) AI provider for **ElevenLabs** — the audio
leg of the `@thomasfosterau/effect-ai-*` family. Effect ships no ElevenLabs
package, so this implements
[`@thomasfosterau/effect-ai-ext`](../effect-ai-ext)'s audio abstractions
directly against the ElevenLabs API.

- **`ElevenLabsClient`** — the low-level HTTP client (binary and chunked
  streaming audio, multipart uploads), every failure mapped to `AiError`. Its
  `apiUrl` override is the BYOK contract used by a routing layer (the gateway),
  and the key is sent as the `xi-api-key` header.
- **`ElevenLabsSpeechModel`** — the `SpeechModel` (text-to-speech): a one-shot
  `generate` returning the full audio buffer, and a backpressured,
  interruption-safe `stream` of audio chunks.
- **`ElevenLabsTranscriptionModel`** — the `TranscriptionModel` over Scribe
  (speech-to-text) with per-word segment timestamps and detected language.
- **`ElevenLabsVoiceConversionModel`** — the `VoiceConversionModel`
  (speech-to-speech).

## Install

```sh
pnpm add @thomasfosterau/effect-ai-elevenlabs @thomasfosterau/effect-ai-ext effect
```

`effect` is a peer dependency (it must be a singleton).

## Usage

```ts
import { Effect, Layer, Redacted, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { SpeechModel } from "@thomasfosterau/effect-ai-ext";
import { ElevenLabsClient, ElevenLabsSpeechModel } from "@thomasfosterau/effect-ai-elevenlabs";

const SpeechLayer = ElevenLabsSpeechModel.layer({
  voiceId: "21m00Tcm4TlvDq8ikWAM",
  modelId: "eleven_multilingual_v2",
}).pipe(
  Layer.provide(ElevenLabsClient.layer({ apiKey: Redacted.make(process.env.ELEVENLABS_API_KEY!) })),
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

The neutral `format` / `sampleRate` speech options map onto ElevenLabs'
combined `output_format` (e.g. `pcm` + `24000` → `pcm_24000`); pass a full
ElevenLabs id via `outputFormat` (or a `format` that already contains an
underscore) for exact control. Scribe transcription and speech-to-speech accept
audio as bytes or a `Stream` (drained to the multipart upload those endpoints
require).

## License

MIT
