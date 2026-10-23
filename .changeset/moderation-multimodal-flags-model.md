---
"@thomasfosterau/effect-ai-ext": minor
"@thomasfosterau/effect-ai-gateway": minor
---

`ModerationModel` can screen images and report more of the provider's reading (#143).

- **Multimodal inputs.** `ModerationOptions.inputs` (and `ProviderOptions.inputs`) take `ModerationInput`: a string, or an array of `effect/ai` user-message parts (`Prompt.UserMessagePartEncoded`, text and file) screened as one input. An empty part list fails with `AiError.InvalidUserInputError`. Breaking for provider implementations, which must now accept the wider input type; callers that pass strings are unaffected. `fromLanguageModel` sends a multimodal batch as a system message of instructions and a user message of parts, every caller text part JSON-quoted like a string input.
- **Per-category flags.** `ModerationResult.flags?: Record<string, boolean>` carries the provider's own verdict per category; the OpenAI provider fills it from `categories` (nulls dropped).
- **Resolved model id.** `ModerationResponse.modelId?: string` names the model that served the call (OpenAI's dated snapshot; a `LanguageModel`'s response metadata for `fromLanguageModel`).
- **Call ledger.** `OpenAiModerationOptions.onCall` observes each HTTP call's `status`, `durationMillis` and `error` (`OpenAiModerationCall`), on success and failure, on both transports.
- The OpenAI provider sends image file parts as `image_url` parts, one request per multimodal input; a non-image file part fails with `AiError.InvalidUserInputError` before any request.
