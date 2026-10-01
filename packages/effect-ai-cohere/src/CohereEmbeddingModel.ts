/**
 * @copyright Thomas Foster
 *
 * `CohereEmbeddingModel` — the Cohere implementation of Effect AI's
 * `EmbeddingModel` service over Cohere's `/v2/embed` endpoint (via
 * {@link CohereClient}). It embeds a batch of texts into fixed-dimension
 * float vectors.
 *
 * The pinned model (`embed-v4.0`) and output dimension (1024) live here as the
 * single source of truth — one edit rotates the model or dimension. `embed-v4`
 * is retrieval-aware: `inputType` selects the intent (`search_document` for
 * stored documents, `search_query` for search queries, plus `classification`,
 * `clustering`, and `image`), and the output dimension is pinned explicitly on
 * every request rather than trusting the model default.
 *
 * @module CohereEmbeddingModel
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as EmbeddingModel from "effect/ai/EmbeddingModel";
import { CohereClient } from "./CohereClient";

/** Cohere's embedding model. A single constant so rotation is one edit. */
export const EMBEDDING_MODEL = "embed-v4.0";

/**
 * `embed-v4`'s output dimension, pinned explicitly on every request rather
 * than trusting the model's default. `embed-v4` supports 256 / 512 / 1024 /
 * 1536; 1024 is the pinned default here.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/** The retrieval-aware input intents Cohere's embed endpoint accepts. */
export type InputType =
  | "search_document"
  | "search_query"
  | "classification"
  | "clustering"
  | "image";

/** Configuration for constructing a {@link CohereEmbeddingModel}. */
export interface Options {
  /**
   * Cohere's retrieval-aware input type — embed stored documents with
   * `"search_document"` and search queries with `"search_query"`.
   */
  readonly inputType: InputType;
  /**
   * The embedding model id.
   *
   * @default "embed-v4.0"
   */
  readonly model?: (string & {}) | undefined;
  /**
   * The output vector dimension, pinned on every request.
   *
   * @default 1024
   */
  readonly outputDimension?: number | undefined;
}

/**
 * Constructs an `EmbeddingModel` service backed by {@link CohereClient}.
 *
 * @see {@link layer} for providing the service as a `Layer`
 */
export const make = (options: Options): Effect.Effect<EmbeddingModel.EmbeddingModel, never, CohereClient> =>
  Effect.gen(function* () {
    const client = yield* CohereClient;
    const model = options.model ?? EMBEDDING_MODEL;
    const outputDimension = options.outputDimension ?? EMBEDDING_DIMENSIONS;
    return yield* EmbeddingModel.make({
      embedMany: ({ inputs }) =>
        client
          .embed({
            model,
            input_type: options.inputType,
            texts: inputs,
            output_dimension: outputDimension,
            embedding_types: ["float"],
          })
          .pipe(
            Effect.map((response) => ({
              results: response.embeddings.float.map((vector) => [...vector]),
              usage: { inputTokens: response.meta?.billed_units?.input_tokens },
            })),
          ),
    });
  });

/**
 * Provides {@link CohereEmbeddingModel} as an `EmbeddingModel` layer, drawing
 * {@link CohereClient} from another layer.
 */
export const layer = (
  options: Options,
): Layer.Layer<EmbeddingModel.EmbeddingModel, never, CohereClient> =>
  Layer.effect(EmbeddingModel.EmbeddingModel, make(options));
