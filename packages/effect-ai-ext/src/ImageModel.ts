/**
 * Defines the provider-neutral service for image generation.
 *
 * An `ImageModel` turns a text prompt into one or more images — the sibling of
 * `LanguageModel` and `EmbeddingModel` from `effect/ai` (which has no
 * image module yet). Each image part carries either raw bytes or a base64
 * string plus its media type, and provider failures stay represented as
 * `AiError` values.
 *
 * The shape mirrors `EmbeddingModel`: a provider supplies one `generate`
 * function through {@link make}, and the result is validated (at least one
 * image, no more than the requested `count`) before being returned.
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AiError } from "effect/ai";

/**
 * Service tag for image model operations.
 *
 * **When to use**
 *
 * Use to retrieve or provide the image model service for an `Effect` program
 * that generates images from text.
 *
 * @see {@link Service} for the service contract provided by this tag
 * @see {@link make} for constructing an image model service from a provider
 *
 * @category services
 */
export class ImageModel extends Context.Service<ImageModel, Service>()(
  "@thomasfosterau/effect-ai-ext/ImageModel",
) {}

/**
 * Represents usage metadata for an image generation operation.
 *
 * **Details**
 *
 * `inputTokens` is `undefined` when the provider does not report usage.
 *
 * @category models
 */
export class ImageUsage extends Schema.Class<ImageUsage>(
  "@thomasfosterau/effect-ai-ext/ImageModel/ImageUsage",
)({
  inputTokens: Schema.UndefinedOr(Schema.Finite),
}) {}

/**
 * One generated image: its data (raw bytes or a base64 string) and media type.
 *
 * @category models
 */
export class ImagePart extends Schema.Class<ImagePart>(
  "@thomasfosterau/effect-ai-ext/ImageModel/ImagePart",
)({
  /** Image payload: `Uint8Array` for raw bytes, `string` for base64. */
  data: Schema.Union([Schema.Uint8Array, Schema.String]),
  /** IANA media type of the image (e.g. `image/png`). */
  mediaType: Schema.String,
}) {}

/**
 * Response for an image generation request.
 *
 * @see {@link ImagePart} for individual images
 * @see {@link ImageUsage} for usage metadata
 *
 * @category models
 */
export class ImageResponse extends Schema.Class<ImageResponse>(
  "@thomasfosterau/effect-ai-ext/ImageModel/ImageResponse",
)({
  images: Schema.Array(ImagePart),
  usage: ImageUsage,
}) {}

/**
 * Caller-facing input options for an image generation request.
 *
 * @category options
 */
export interface ImageOptions {
  /** The prompt describing the image to generate. */
  readonly prompt: string;
  /** Desired image size (e.g. `1024x1024`); provider default when omitted. */
  readonly size?: string | undefined;
  /** Desired image format (e.g. `png`, `jpeg`, `webp`). */
  readonly format?: string | undefined;
  /** Number of images to generate. */
  readonly count?: number | undefined;
}

/**
 * Provider input options for image generation requests.
 *
 * @category options
 */
export interface ProviderOptions {
  readonly prompt: string;
  readonly size: string | undefined;
  readonly format: string | undefined;
  readonly count: number | undefined;
}

/**
 * Provider response contract consumed by {@link make}.
 *
 * @category models
 */
export interface ProviderResponse {
  readonly images: ReadonlyArray<{
    readonly data: Uint8Array | string;
    readonly mediaType: string;
  }>;
  readonly usage: { readonly inputTokens: number | undefined };
}

/**
 * Defines the service interface for image operations.
 *
 * @category models
 */
export interface Service {
  readonly generate: (options: ImageOptions) => Effect.Effect<ImageResponse, AiError.AiError>;
}

const invalidProviderResponse = (description: string): AiError.AiError =>
  AiError.make({
    module: "ImageModel",
    method: "generate",
    reason: new AiError.InvalidOutputError({ description }),
  });

const mapProviderResponse = (
  count: number | undefined,
  response: ProviderResponse,
): Effect.Effect<ImageResponse, AiError.AiError> => {
  if (response.images.length === 0) {
    return Effect.fail(invalidProviderResponse("Provider returned no images"));
  }
  if (count !== undefined && response.images.length > count) {
    return Effect.fail(
      invalidProviderResponse(
        `Provider returned ${response.images.length} images but at most ${count} were requested`,
      ),
    );
  }
  const images = response.images.map(
    (image) => new ImagePart({ data: image.data, mediaType: image.mediaType }),
  );
  return Effect.succeed(
    new ImageResponse({
      images,
      usage: new ImageUsage({ inputTokens: response.usage.inputTokens }),
    }),
  );
};

/**
 * Creates an `ImageModel` service from a provider generate implementation — the
 * analogue of `EmbeddingModel.make`.
 *
 * **Details**
 *
 * The provider must return at least one image and no more than the requested
 * `count` (when set); violations fail with `AiError.InvalidOutputError`.
 *
 * @see {@link Service} for the service shape returned by this constructor
 * @see {@link ProviderOptions} for the input passed to the provider implementation
 * @see {@link ProviderResponse} for the provider response contract consumed by this constructor
 *
 * @category constructors
 */
export const make = (params: {
  readonly generate: (
    options: ProviderOptions,
  ) => Effect.Effect<ProviderResponse, AiError.AiError>;
}): Effect.Effect<Service> =>
  Effect.sync(() =>
    ImageModel.of({
      generate: (options) =>
        params
          .generate({
            prompt: options.prompt,
            size: options.size,
            format: options.format,
            count: options.count,
          })
          .pipe(
            Effect.flatMap((response) => mapProviderResponse(options.count, response)),
            Effect.withSpan("ImageModel.generate"),
          ),
    }),
  );
