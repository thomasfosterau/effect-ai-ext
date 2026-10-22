/**
 * Wire-format definitions for Voyage AI's `/v1/embeddings` and `/v1/rerank`
 * endpoints.
 *
 * Request payloads are hand-built plain objects (typed by the `*Request`
 * interfaces here) rather than encoded through a schema — the provider
 * constructs them field-by-field and sends them as JSON. Only the response
 * bodies get Effect `Schema`s, because those are the untrusted inputs that
 * must be decoded and validated before the models convert them into Effect
 * AI / effect-ai-ext response shapes.
 *
 * Optional response fields are modelled leniently (`Schema.optional` +
 * `Schema.NullOr`) so that a newly-added Voyage field never fails decoding of
 * an otherwise-valid response — the mapping layer reads the fields it knows
 * and ignores the rest.
 *
 * @module internal/wire
 *
 * @copyright Thomas Foster
 */

import * as Schema from "effect/Schema";

// ── Requests ──────────────────────────────────────────────────────────

/**
 * The retrieval-aware input type. Voyage prepends a prompt for asymmetric
 * retrieval — embed stored documents with `"document"` and search queries
 * with `"query"`. `null`/omitted embeds the text as-is.
 */
export type InputType = "query" | "document" | null;

/** The full `/v1/embeddings` request body. */
export interface EmbeddingRequest {
  readonly model: string;
  /** One string or a batch of strings to embed. */
  readonly input: string | ReadonlyArray<string>;
  readonly input_type?: InputType;
  /**
   * The Matryoshka output dimension. Only the models that advertise multiple
   * dimensions honour it; omit to take the model's native default.
   */
  readonly output_dimension?: number;
  /** Numeric type of the returned embeddings. Only `"float"` is decoded here. */
  readonly output_dtype?: "float";
  /** Whether to truncate over-length inputs rather than error. */
  readonly truncation?: boolean;
}

/** The full `/v1/rerank` request body. */
export interface RerankRequest {
  readonly model: string;
  readonly query: string;
  readonly documents: ReadonlyArray<string>;
  /** Return at most this many of the highest-scoring documents. */
  readonly top_k?: number;
  /** Whether to echo the document text back in each result. */
  readonly return_documents?: boolean;
  /** Whether to truncate over-length inputs rather than error. */
  readonly truncation?: boolean;
}

// ── Shared ────────────────────────────────────────────────────────────

/**
 * Token accounting Voyage reports on both endpoints. Left lenient — a
 * missing or newly-added counter never fails an otherwise-valid response.
 */
const Usage = Schema.Struct({
  total_tokens: Schema.optional(Schema.Finite),
});

// ── Embeddings response ───────────────────────────────────────────────

/** One embedding entry in an `/v1/embeddings` response. */
const EmbeddingDatum = Schema.Struct({
  object: Schema.optional(Schema.String),
  /** The embedding vector. Required — a datum without it is not usable. */
  embedding: Schema.Array(Schema.Finite),
  /** Position of this embedding in the request's `input` array. */
  index: Schema.optional(Schema.Finite),
});

/** The decoded body of a `/v1/embeddings` response. */
export const EmbeddingResponse = Schema.Struct({
  object: Schema.optional(Schema.String),
  data: Schema.Array(EmbeddingDatum),
  model: Schema.optional(Schema.String),
  usage: Schema.optional(Schema.NullOr(Usage)),
});

/** Decoded embeddings response type. */
export type EmbeddingResponse = typeof EmbeddingResponse.Type;

// ── Rerank response ───────────────────────────────────────────────────

/** One reranked document entry in a `/v1/rerank` response. */
const RerankDatum = Schema.Struct({
  /** Index of this document in the request's `documents` array. */
  index: Schema.Finite,
  /** Relevance of the document to the query; higher is more relevant. */
  relevance_score: Schema.Finite,
  document: Schema.optional(Schema.NullOr(Schema.String)),
});

/** The decoded body of a `/v1/rerank` response. */
export const RerankResponse = Schema.Struct({
  object: Schema.optional(Schema.String),
  data: Schema.Array(RerankDatum),
  model: Schema.optional(Schema.String),
  usage: Schema.optional(Schema.NullOr(Usage)),
});

/** Decoded rerank response type. */
export type RerankResponse = typeof RerankResponse.Type;
