/**
 * A typed stub for the Worker's `AI` binding.
 *
 * The code under test reaches the binding only through
 * `ai.gateway(gatewayId).getUrl(provider)` and `.run(data, options)`
 * (`src/Binding.ts`). A stub implements that slice with the package's own
 * `WorkersAiGateway` signatures rather than hiding behind an
 * `as unknown as WorkersAiBinding`, so a stub that drifts from them is a type
 * error under a manual `tsc` with a tsconfig that includes `tests/`. No gate
 * catches it: this package's `tsconfig.json` type-checks `src` only, and the
 * suites run type-stripped. That a real Workers `Ai` binding satisfies the same
 * types is `workers-types-binding.test.ts`'s job.
 *
 * @module tests/helpers/ai
 */

import type { WorkersAiBinding, WorkersAiGateway } from "@thomasfosterau/effect-ai-gateway";

/** The slice of the AI Gateway runtime object a stub implements. */
export type GatewayStub = Partial<WorkersAiGateway>;

// SAFETY: `WorkersAiBinding` is assignable to
// `{ gateway: (id: string) => GatewayStub }`, so this is a single narrowing
// assertion TypeScript checks, not a cast through `unknown`. The code under
// test calls nothing on the binding but `gateway(id).getUrl` / `.run`, and
// each test stubs the one it reaches.
/** Builds a stub binding whose `gateway(gatewayId)` returns `gateway(gatewayId)`. */
export const stubAiBinding = (gateway: (gatewayId: string) => GatewayStub): WorkersAiBinding =>
  ({ gateway }) as WorkersAiBinding;
