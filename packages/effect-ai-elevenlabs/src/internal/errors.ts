/**
 * Maps the failure channels of the underlying HTTP client — transport
 * failures, non-2xx statuses, and body-decode failures — plus schema
 * decode failures, into the unified `AiError` surface every Effect AI
 * provider presents. Status codes are classified through the shared
 * `AiError.reasonFromHttpStatus` (so 401 → authentication, 429 → rate
 * limit, 5xx → internal-provider, etc.) rather than a bespoke table.
 *
 * @module internal/errors
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Option from "effect/Option";
import * as Redactable from "effect/Redactable";
import type * as Schema from "effect/Schema";
import * as AiError from "effect/ai/AiError";
import type * as HttpClientError from "effect/http/HttpClientError";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";

const MODULE = "ElevenLabsClient";

const buildRequestDetails = (
  request: HttpClientRequest.HttpClientRequest,
): (typeof AiError.HttpContext.Type)["request"] => ({
  method: request.method,
  url: request.url,
  urlParams: Array.from(request.urlParams),
  hash: Option.getOrUndefined(request.hash),
  headers: Redactable.redact(request.headers) as Record<string, string>,
});

/** Wraps a schema decode failure as an `InvalidOutputError`. */
export const mapSchemaError = dual<
  (method: string) => (error: Schema.SchemaError) => AiError.AiError,
  (error: Schema.SchemaError, method: string) => AiError.AiError
>(2, (error, method) =>
  AiError.make({
    module: MODULE,
    method,
    reason: AiError.InvalidOutputError.fromSchemaError(error),
  }),
);

/**
 * Translates an `HttpClientError` into a failing effect carrying the mapped
 * `AiError`. Non-2xx statuses (only reachable through `filterStatusOk`) read
 * the response body for context before classifying via
 * `AiError.reasonFromHttpStatus`; transport-level failures become
 * `NetworkError`; body problems become `InvalidOutputError`.
 */
export const mapHttpClientError = dual<
  (
    method: string,
  ) => (error: HttpClientError.HttpClientError) => Effect.Effect<never, AiError.AiError>,
  (error: HttpClientError.HttpClientError, method: string) => Effect.Effect<never, AiError.AiError>
>(2, (error, method) => {
  const reason = error.reason;
  switch (reason._tag) {
    case "TransportError":
    case "EncodeError":
    case "InvalidUrlError": {
      return Effect.fail(
        AiError.make({
          module: MODULE,
          method,
          reason: new AiError.NetworkError({
            reason: reason._tag,
            description: reason.description,
            request: buildRequestDetails(reason.request),
          }),
        }),
      );
    }
    case "StatusCodeError": {
      return mapStatusCodeError(reason, method);
    }
    default: {
      // DecodeError / EmptyBodyError — a 2xx response whose body could not be read.
      return Effect.fail(
        AiError.make({
          module: MODULE,
          method,
          reason: new AiError.InvalidOutputError({
            description: reason.description ?? "Failed to read ElevenLabs response body",
          }),
        }),
      );
    }
  }
});

const mapStatusCodeError = Effect.fnUntraced(function* (
  error: HttpClientError.StatusCodeError,
  method: string,
) {
  const { request, response } = error;
  const bodyOption = yield* Effect.option(response.text);
  const body = Option.getOrUndefined(bodyOption);
  const reason = AiError.reasonFromHttpStatus({
    status: response.status,
    body,
    http: {
      request: buildRequestDetails(request),
      response: {
        status: response.status,
        headers: Redactable.redact(response.headers) as Record<string, string>,
      },
      body,
    },
  });
  return yield* AiError.make({ module: MODULE, method, reason });
});
