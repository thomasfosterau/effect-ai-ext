/**
 * Route Effect AI providers (Anthropic, Cohere, OpenAI moderation) through a
 * Cloudflare AI Gateway, by Worker binding or by the public HTTPS endpoint
 * (the `…FromUrl` variants). Provider keys are BYOK, configured on the
 * gateway, so no layer here takes a vendor API key except OpenAI
 * moderation's opt-in `apiKey`.
 *
 * @module effect-ai-gateway
 */

import * as RerankerModelExt from "@thomasfosterau/effect-ai-ext/RerankerModel";

export * from "./Anthropic";
export * from "./Binding";
export * from "./Cohere";
export * from "./OpenAiModeration";
// Re-exported straight from effect-ai-ext, NOT via the local `./RerankerModel`
// shim: `Cohere.ts` namespace-imports that shim, so the esbuild bundle of the
// former tsup build folded a `export * from "./RerankerModel"` into an
// internal `__reExport` object and the bundled `dist/index.js` never named
// `make` / `RerankerModel` / … as real ESM exports (a Node `import { make }`
// then threw). Bindings on a direct import of the external module survive
// bundling as real exports. The shim module stays for `Cohere.ts`. (rolldown,
// under `vp pack`, folds the shim too but still emits the external
// `export *`; the direct re-export stays until its 0.5.0 removal.)
//
// One aliased binding per name, each with its own `@deprecated` tag, so
// editors strike the gateway import through (#60). Not `export *`, which
// carries no tag, and not `export { /** @deprecated */ make } from …`:
// TypeScript honours a tag on an export specifier, but `vp pack`'s
// declaration bundler (tsdown's rolldown-plugin-dts) drops comments on
// specifiers, so the published `.d.ts` would lose every tag. Each class is
// re-bound as a value plus a type of the same name, so `RerankerModel` stays
// both the tag and its instance type, as before. Keep this list equal to effect-ai-ext's `RerankerModel`
// exports (`tests/module-load.test.ts` checks the value names) until the
// re-export is removed.

/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export const RerankerModel = RerankerModelExt.RerankerModel;
/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export type RerankerModel = RerankerModelExt.RerankerModel;

/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export const RerankerUsage = RerankerModelExt.RerankerUsage;
/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export type RerankerUsage = RerankerModelExt.RerankerUsage;

/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export const RerankedDocument = RerankerModelExt.RerankedDocument;
/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export type RerankedDocument = RerankerModelExt.RerankedDocument;

/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export const RerankResponse = RerankerModelExt.RerankResponse;
/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export type RerankResponse = RerankerModelExt.RerankResponse;

/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export const make = RerankerModelExt.make;

/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export type RerankOptions = RerankerModelExt.RerankOptions;

/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export type ProviderOptions = RerankerModelExt.ProviderOptions;

/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export type ProviderResponse = RerankerModelExt.ProviderResponse;

/** @deprecated Import from `@thomasfosterau/effect-ai-ext/RerankerModel`; removed from the gateway in 0.5.0. */
export type Service = RerankerModelExt.Service;

export * from "./Url";
