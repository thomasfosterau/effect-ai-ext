/**
 * Shared stub for the `RerankerModel` abstraction.
 *
 * Builds a service through the real `RerankerModel.make` with a canned provider
 * hook, so tests exercise the abstraction's validation and normalisation while
 * never reaching a provider. Returns the service plus a call log for asserting
 * pass-through and short-circuit behaviour.
 *
 * @module tests/unit/helpers/reranker
 */

import * as Effect from "effect/Effect";
import { AiError } from "effect/unstable/ai";
import {
  make,
  type ProviderOptions,
  type ProviderResponse,
  type Service,
} from "@thomasfosterau/effect-ai-ext/RerankerModel";

export const makeStubReranker = (
  behaviour:
    | { readonly respond: (options: ProviderOptions) => ProviderResponse }
    | { readonly fail: true }
    | { readonly hang: true },
): Effect.Effect<{ readonly model: Service; readonly calls: ProviderOptions[] }> =>
  Effect.gen(function* () {
    const calls: ProviderOptions[] = [];
    const model = yield* make({
      rerank: (options) =>
        Effect.gen(function* () {
          if ("fail" in behaviour) {
            return yield* AiError.make({
              module: "test",
              method: "rerank",
              reason: new AiError.UnknownError({ description: "stubbed failure" }),
            });
          }
          calls.push(options);
          if ("hang" in behaviour) return yield* Effect.never;
          return behaviour.respond(options);
        }),
    });
    return { model, calls };
  });
