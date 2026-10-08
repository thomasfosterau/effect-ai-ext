---
"@thomasfosterau/effect-ai-gateway": minor
---

**Breaking:** the OpenAI moderation models (`makeOpenAiModerationModel`, `makeOpenAiModerationModelFromUrl`) report the provider's `flagged` verdict as `isFlagged`, following `@thomasfosterau/effect-ai-ext`'s `ModerationModel` rename (#98). The wire field is still OpenAI's `flagged`; it is renamed where the response is decoded. Read `result.isFlagged` instead of `result.flagged`.
