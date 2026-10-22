# @thomasfosterau/effect-ai-elevenlabs

A first-party provider over the ElevenLabs API: `ElevenLabsClient` (text-to-speech, streaming text-to-speech, Scribe speech-to-text, speech-to-speech) and the `effect-ai-ext` `SpeechModel`, `TranscriptionModel` and `VoiceConversionModel` over it. Shaped like `effect-ai-mistral`.

## Boundary

Peer: `effect`. May import `@thomasfosterau/effect-ai-ext` (a `workspace:*` dependency) and nothing else from this workspace (`.fallowrc.json` zone `elevenlabs`).

## Invariants

- **`apiUrl` is a contract**: it is how a routing layer repoints the client for BYOK. The key is sent as `xi-api-key`, never `authorization`; omitted, no key header is sent. `tests/elevenlabs.test.ts` points `apiUrl` at a stub.
- **Errors leave the package only as `AiError`**, mapped in `internal/errors.ts` through `AiError.reasonFromHttpStatus`. Text-to-speech with no voice (neither the call's `voice` nor the model's `voiceId`) fails as invalid user input.
- **Streaming TTS output is never buffered**: chunks are pulled from the HTTP body on demand, and interrupting the consumer aborts the request (`tests/elevenlabs.test.ts` proves backpressure and interruption). Only _input_ audio for the multipart endpoints (Scribe, speech-to-speech) is collected whole (`internal/audio.ts`), because those endpoints need a complete file.
- **`output_format` resolution**: the model's `outputFormat` wins; a call `format` containing `_` is a full ElevenLabs id; otherwise `format` + `sampleRate` join (`pcm` + `24000` → `pcm_24000`); none lets ElevenLabs default.
- **Transcription segments are spoken words only**: spacing / audio-event tokens and words without both timestamps are dropped; `usage.durationSeconds` is the latest word end.
