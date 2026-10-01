/**
 * `CohereClassifierModel` — the Cohere implementation of effect-ai-ext's
 * `ClassifierModel` service. It assigns labelled classes with confidence
 * scores to each input text.
 *
 * ## Why chat + structured output rather than `/v1/classify`
 *
 * Cohere's dedicated Classify surface is **v1-legacy and being retired**:
 *
 * - There is no `v2/classify` — Classify was never carried into Cohere's v2
 *   API line (`v2/chat`, `v2/embed`, `v2/rerank`).
 * - As of 2025-01-31 Cohere deprecated Classify via the default (non
 *   fine-tuned) Embed models; `/v1/classify` now requires a **fine-tuned**
 *   Embed model, so it can no longer perform ad-hoc zero-shot classification.
 * - `/v1/classify`'s contract is example/fine-tune driven (labels are induced
 *   from `examples` or the fine-tune) and does not map onto this abstraction's
 *   `ClassifierModel.ClassifyOptions` — arbitrary caller label sets,
 *   open-set classification, and optional multi-label all fall outside it.
 *
 * The abstraction ships `ClassifierModel.fromLanguageModel` for exactly this
 * situation, so `CohereClassifierModel` backs the classifier with Cohere
 * **chat + structured output** over a Command model ({@link CohereLanguageModel}).
 * That covers the full `ClassifyOptions` contract (caller label sets, open-set
 * labels, multi-label, example-shot) and stays on Cohere's supported v2 chat
 * surface. The decoded structured output flows through the same validation and
 * normalisation path as any native classifier.
 *
 * See the sibling `@effect/ai-*` posture and the issue #3 discussion for the
 * rationale. A future first-party binding against a fine-tuned `/v1/classify`
 * model could be added alongside this without changing the public surface.
 *
 * @module CohereClassifierModel
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LanguageModel from "effect/ai/LanguageModel";
import * as ClassifierModel from "@thomasfosterau/effect-ai-ext/ClassifierModel";
import { CohereClient } from "./CohereClient";
import * as CohereLanguageModel from "./CohereLanguageModel";

/** A Command chat model well-suited to classification, the default here. */
export const DEFAULT_MODEL = "command-a-03-2025";

/** Configuration for constructing a {@link CohereClassifierModel}. */
export interface Options {
  /**
   * The Command chat model backing the classifier.
   *
   * @default "command-a-03-2025"
   */
  readonly model?: (string & {}) | CohereLanguageModel.Model | undefined;
  /**
   * Chat request tuning (temperature, etc.) applied to each classification
   * request. Defaults to a temperature of 0 for deterministic labelling.
   */
  readonly config?: Omit<CohereLanguageModel.ConfigService, "model"> | undefined;
}

/**
 * Constructs a `ClassifierModel.Service` backed by Cohere chat + structured
 * output, drawing {@link CohereClient} from context.
 *
 * @see {@link layer} for providing the service as a `Layer`
 */
export const make = (
  options?: Options,
): Effect.Effect<ClassifierModel.Service, never, CohereClient> =>
  Effect.gen(function* () {
    const languageModel = yield* CohereLanguageModel.make({
      model: options?.model ?? DEFAULT_MODEL,
      config: { temperature: 0, ...options?.config },
    });
    return yield* ClassifierModel.fromLanguageModel.pipe(
      Effect.provideService(LanguageModel.LanguageModel, languageModel),
    );
  });

/**
 * Provides {@link CohereClassifierModel} as a `ClassifierModel` layer, drawing
 * {@link CohereClient} from another layer.
 */
export const layer = (
  options?: Options,
): Layer.Layer<ClassifierModel.ClassifierModel, never, CohereClient> =>
  Layer.effect(ClassifierModel.ClassifierModel, make(options));
