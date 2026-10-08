---
"@thomasfosterau/effect-ai-ext": minor
---

**Breaking:** `ModerationModel`'s boolean verdict is renamed from `flagged` to `isFlagged` (#98), following the Effect lint preset's boolean-prefix convention. Both `ModerationResult.isFlagged` and the `ProviderResponse` contract a provider hands `ModerationModel.make` now use the new name: read `result.isFlagged` instead of `result.flagged`, and have a custom provider return `{ isFlagged, categories }`. `fromLanguageModel` still asks the model for a `flagged` field (the moderation APIs' own name) and decodes it to `isFlagged`.
