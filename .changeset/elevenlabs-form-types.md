---
"@thomasfosterau/effect-ai-elevenlabs": patch
---

`ElevenLabsClient`'s `speechToText` and `speechToSpeech` form types now accept `undefined` for their optional fields (#98). The client builds the multipart body from them without a type assertion, and an `undefined` field is still left out of the body. The bytes sent are unchanged.
