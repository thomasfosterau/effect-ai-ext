/**
 * A typed stub for the Worker's `AI` binding.
 *
 * The code under test reaches the binding only through
 * `ai.gateway(gatewayId).getUrl(provider)` and `.run(data, options)`
 * (`src/Binding.ts`). A stub implements that slice with `AiGateway`'s own
 * signatures, so a stub that drifts from the Workers types fails to compile
 * rather than hiding behind an `as unknown as Ai`.
 *
 * @module tests/unit/helpers/ai
 */

/** The slice of the `AiGateway` runtime object this package calls. */
export interface GatewayStub {
  readonly getUrl?: AiGateway["getUrl"];
  readonly run?: AiGateway["run"];
}

// SAFETY: `Ai` is assignable to `{ gateway: (id: string) => GatewayStub }`, so
// this is a single narrowing assertion TypeScript checks, not a cast through
// `unknown`. The code under test calls nothing on the binding but
// `gateway(id).getUrl` / `.run`, which the stub implements with the Workers
// signatures; the rest of the `Ai` surface is never reached.
/** Builds a stub `Ai` binding whose `gateway(gatewayId)` returns `gateway(gatewayId)`. */
export const stubAiBinding = (gateway: (gatewayId: string) => GatewayStub): Ai =>
  ({ gateway }) as Ai;
