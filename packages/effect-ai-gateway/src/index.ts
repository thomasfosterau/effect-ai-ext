/**
 * Route Effect AI providers (Anthropic, Cohere, OpenAI moderation) through a
 * Cloudflare AI Gateway, by Worker binding or by the public HTTPS endpoint
 * (the `…FromUrl` variants). Provider keys are BYOK, configured on the
 * gateway, so no layer here takes a vendor API key except OpenAI
 * moderation's opt-in `apiKey`.
 *
 * @module effect-ai-gateway
 */

export * from "./Anthropic";
export * from "./Binding";
export * from "./Cohere";
export * from "./OpenAiModeration";
// Re-exported straight from effect-ai-ext, NOT via the local `./RerankerModel`
// shim: `Cohere.ts` namespace-imports that shim, so esbuild folds a
// `export * from "./RerankerModel"` into an internal `__reExport` object and
// the bundled `dist/index.js` never names `make` / `RerankerModel` / … as real
// ESM exports (a Node `import { make }` then throws). A direct external
// `export *` survives bundling verbatim. The shim module stays for `Cohere.ts`.
export * from "@thomasfosterau/effect-ai-ext/RerankerModel";
export * from "./Url";
