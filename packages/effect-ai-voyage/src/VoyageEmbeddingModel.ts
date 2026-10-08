/**
 * `VoyageEmbeddingModel` — the Voyage AI implementation of Effect AI's
 * `EmbeddingModel` service. It maps a batch of inputs onto Voyage's
 * `/v1/embeddings` request (via {@link VoyageClient}), then converts the
 * response's per-input vectors back into an `EmbeddingModel.ProviderResponse`.
 *
 * The model is chosen at construction, along with Voyage's retrieval-aware
 * `input_type` (embed stored documents with `"document"`, search queries with
 * `"query"`) and an optional Matryoshka `output_dimension`. The
 * {@link EMBEDDING_MODELS} matrix documents the current Voyage embedding model
 * ids with their native and selectable dimensions.
 *
 * @module VoyageEmbeddingModel
 *
 * @copyright Thomas Foster
 */

import * as Order from "effect/Order";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as EmbeddingModel from "effect/ai/EmbeddingModel";
import * as AiModel from "effect/ai/Model";
import { VoyageClient } from "./VoyageClient";
import type * as Wire from "./internal/wire";

// =============================================================================
// Model / dimension matrix
// =============================================================================

/**
 * Static metadata for a Voyage embedding model.
 *
 * `defaultDimension` is the vector size Voyage returns when `output_dimension`
 * is omitted. `dimensions` lists every size the model accepts — a single
 * entry means the dimension is fixed; multiple entries (a Matryoshka model)
 * means any listed value may be requested via {@link Options.outputDimension}.
 * `contextLength` is the maximum tokens per input.
 */
export interface EmbeddingModelInfo {
  readonly defaultDimension: number;
  readonly dimensions: ReadonlyArray<number>;
  readonly contextLength: number;
}

/**
 * The current Voyage embedding models and their dimensions.
 *
 * Matryoshka models (`voyage-3-large`, `voyage-3.5`, `voyage-3.5-lite`,
 * `voyage-code-3`) accept `output_dimension` ∈ {256, 512, 1024, 2048} and
 * default to 1024. The remaining, domain- and generation-specific models
 * return a single fixed dimension. Values track Voyage's published
 * documentation; a model id absent here still works — the constructors accept
 * any string, and Voyage applies the model's own default when
 * `output_dimension` is omitted.
 */
export const EMBEDDING_MODELS = {
  "voyage-3-large": {
    defaultDimension: 1024,
    dimensions: [256, 512, 1024, 2048],
    contextLength: 32000,
  },
  "voyage-3.5": {
    defaultDimension: 1024,
    dimensions: [256, 512, 1024, 2048],
    contextLength: 32000,
  },
  "voyage-3.5-lite": {
    defaultDimension: 1024,
    dimensions: [256, 512, 1024, 2048],
    contextLength: 32000,
  },
  "voyage-code-3": {
    defaultDimension: 1024,
    dimensions: [256, 512, 1024, 2048],
    contextLength: 32000,
  },
  "voyage-3": { defaultDimension: 1024, dimensions: [1024], contextLength: 32000 },
  "voyage-3-lite": { defaultDimension: 512, dimensions: [512], contextLength: 32000 },
  "voyage-finance-2": { defaultDimension: 1024, dimensions: [1024], contextLength: 32000 },
  "voyage-law-2": { defaultDimension: 1024, dimensions: [1024], contextLength: 16000 },
  "voyage-multilingual-2": { defaultDimension: 1024, dimensions: [1024], contextLength: 32000 },
  "voyage-code-2": { defaultDimension: 1536, dimensions: [1536], contextLength: 16000 },
} as const satisfies Record<string, EmbeddingModelInfo>;

/**
 * A selection of well-known Voyage embedding model ids, offered for
 * autocomplete only — the constructors accept any string.
 */
export type Model = keyof typeof EMBEDDING_MODELS;

/**
 * Returns the default vector dimension for a known model, or `undefined` for
 * an unrecognised id (Voyage then applies the model's own default).
 */
export const defaultDimension = (model: string): number | undefined =>
  isKnownModel(model) ? EMBEDDING_MODELS[model].defaultDimension : undefined;

/** Whether `model` is one of the ids in {@link EMBEDDING_MODELS}. */
const isKnownModel = (model: string): model is Model => model in EMBEDDING_MODELS;

// =============================================================================
// Options
// =============================================================================

/** Configuration for constructing a {@link VoyageEmbeddingModel}. */
export interface Options {
  /** The Voyage embedding model id. Any string is accepted. */
  readonly model: (string & {}) | Model;
  /**
   * Voyage's retrieval-aware input type. Embed stored documents with
   * `"document"` and search queries with `"query"`; omit to embed as-is.
   */
  readonly inputType?: Wire.InputType | undefined;
  /**
   * The Matryoshka output dimension. Only honoured by the models that list
   * more than one entry in {@link EMBEDDING_MODELS}; omit to take the model's
   * native default.
   */
  readonly outputDimension?: number | undefined;
  /**
   * Whether Voyage truncates over-length inputs (`true`) instead of failing
   * the request. Voyage defaults to `true`.
   */
  readonly truncation?: boolean | undefined;
}

// =============================================================================
// Embedding Model
// =============================================================================

/**
 * Constructs an `EmbeddingModel` service backed by {@link VoyageClient}.
 *
 * @see {@link layer} for providing the service as a `Layer`
 * @see {@link model} for a providable model descriptor
 */
export const make = Effect.fnUntraced(function* (
  options: Options,
): Effect.fn.Return<EmbeddingModel.EmbeddingModel, never, VoyageClient> {
  const client = yield* VoyageClient;

  return yield* EmbeddingModel.make({
    embedMany: ({ inputs }) =>
      client
        .createEmbeddings({
          model: options.model,
          input: inputs,
          ...(Predicate.isNotUndefined(options.inputType)
            ? { input_type: options.inputType }
            : undefined),
          ...(Predicate.isNotUndefined(options.outputDimension)
            ? { output_dimension: options.outputDimension }
            : undefined),
          ...(Predicate.isNotUndefined(options.truncation)
            ? { truncation: options.truncation }
            : undefined),
        })
        .pipe(Effect.map(([body]) => mapResponse(body))),
  });
});

/**
 * Provides {@link VoyageEmbeddingModel} as an `EmbeddingModel.EmbeddingModel`
 * layer, drawing {@link VoyageClient} from another layer.
 */
export const layer = (
  options: Options,
): Layer.Layer<EmbeddingModel.EmbeddingModel, never, VoyageClient> =>
  Layer.effect(EmbeddingModel.EmbeddingModel, make(options));

/**
 * Creates a Voyage embedding model descriptor that can be provided with
 * `Effect.provide`, carrying provider and model metadata.
 *
 * @see {@link layer} for an `EmbeddingModel.EmbeddingModel` layer
 * @see {@link make} for the service effect
 */
export const model = (
  options: Options,
): AiModel.Model<"voyage", EmbeddingModel.EmbeddingModel, VoyageClient> =>
  AiModel.make("voyage", options.model, layer(options));

// =============================================================================
// Response Conversion
// =============================================================================

/**
 * Converts a Voyage embeddings response into an
 * `EmbeddingModel.ProviderResponse`. Entries are sorted by their reported
 * `index` so the result order matches the request's `input` order regardless
 * of provider ordering; entries without an index keep their arrival order.
 * `EmbeddingModel.make` validates that exactly one result was returned per
 * input.
 */
const mapResponse = (body: Wire.EmbeddingResponse): EmbeddingModel.ProviderResponse => {
  const data = Arr.sort(
    body.data.map((datum, arrivalOrder) => ({ datum, order: datum.index ?? arrivalOrder })),
    Order.mapInput(Order.Number, (entry: { readonly order: number }) => entry.order),
  );
  return {
    results: data.map(({ datum }) => [...datum.embedding]),
    usage: { inputTokens: body.usage?.total_tokens },
  };
};
