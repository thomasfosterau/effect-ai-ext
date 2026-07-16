/**
 * Shared judge-model stubbing for the RAG metric suite tests
 * (`tests/metrics/rag/*.test.ts`): the judge `LanguageModel` is stubbed at
 * the provider seam via `LanguageModel.make` (as in
 * `packages/jobs/tests/translation-service.test.ts` and
 * `tests/metrics/geval.test.ts`), so these tests exercise the real
 * structured-output decoding path while never reaching a network.
 *
 * Every RAG metric makes its judge calls in a fixed order (extraction, then
 * classification — or just classification for `contextualPrecision`), so
 * `makeJudgeStub` takes one response producer per expected call, in order,
 * and dies if more calls are made than were configured.
 *
 * @module tests/metrics/rag/helpers
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { LanguageModel } from "effect/unstable/ai";
import { runTest } from "@test-helpers/effect";

/** One captured judge call: the rendered system and user prompt text. */
export interface JudgeCall {
  readonly system: string;
  readonly user: string;
}

/**
 * Builds a `LanguageModel.Service` whose structured-output hook returns the
 * next canned response from `responses`, in call order. Dies if called more
 * times than `responses` has entries — a test asserting on a specific call
 * sequence should fail loudly on an unexpected extra call, not silently
 * decode `undefined`.
 */
export const makeJudgeStub = (
  responses: ReadonlyArray<(call: JudgeCall) => unknown>,
): Effect.Effect<{ readonly model: LanguageModel.Service; readonly calls: JudgeCall[] }> =>
  Effect.gen(function* () {
    const calls: JudgeCall[] = [];
    const model = yield* LanguageModel.make({
      generateText: (options) =>
        Effect.sync(() => {
          const systemMessage = options.prompt.content.find((message) => message.role === "system");
          const userMessage = options.prompt.content.findLast((message) => message.role === "user");
          const system = systemMessage?.role === "system" ? systemMessage.content : "";
          const user =
            userMessage?.role === "user"
              ? userMessage.content.map((part) => ("text" in part ? part.text : "")).join("")
              : "";
          const call = { system, user };
          const respond = responses[calls.length];
          calls.push(call);
          if (!respond) {
            throw new Error(
              `makeJudgeStub: unexpected call ${calls.length} (only ${responses.length} configured)`,
            );
          }
          return [{ type: "text" as const, text: JSON.stringify(respond(call)) }];
        }),
      streamText: () => Stream.die("streamText is not used by the RAG metrics"),
    });
    return { model, calls };
  });

/** Provides a stubbed judge model as the `LanguageModel.LanguageModel` service. */
export const provideJudge = (model: LanguageModel.Service) =>
  Layer.succeed(LanguageModel.LanguageModel, model);

/** A judge that dies if actually called — for tests expecting the model is never reached. */
export const deadJudge = (): Promise<LanguageModel.Service> =>
  runTest(
    LanguageModel.make({
      generateText: () => Effect.die("the RAG metric should not have called the judge"),
      streamText: () => Stream.die("the RAG metric should not have called the judge"),
    }),
  );
