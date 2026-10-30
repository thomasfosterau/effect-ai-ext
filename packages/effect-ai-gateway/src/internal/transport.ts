/**
 * The one request/decode pipeline every provider module built directly on
 * the gateway shares — Cohere (`Cohere.ts`) and OpenAI moderation
 * (`OpenAiModeration.ts`) today. Two transports feed it:
 *
 * - {@link requestViaBinding} — the Worker `AI` binding's universal `run()`
 *   endpoint (`Binding.ts`'s `gatewayRun`), producing a raw `fetch`
 *   `Response`;
 * - {@link requestViaUrl} — the gateway's public HTTPS endpoint over Effect's
 *   `HttpClient` (`Url.ts`), producing an `HttpClientResponse`.
 *
 * Each transport maps its own failure modes into one {@link NormalizedResponse}
 * at construction time, so the status → body → schema pipeline
 * ({@link decodeResponse}) is written once. Every failure is an `AiError`
 * carrying the provider module and method that raised it: a rejected
 * transport call maps to `UnknownError`; non-2xx statuses map through
 * `AiError.reasonFromHttpStatus`; a body that cannot be read is
 * `UnknownError`; an undecodable body is `InvalidOutputError`.
 *
 * Internal — not part of the package's public surface.
 *
 * @module internal/transport
 *
 * @copyright Thomas Foster
 */

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { AiError } from "effect/ai";
import { HttpBody, HttpClient, HttpClientRequest } from "effect/http";
import { gatewayRun, type GatewayBinding, type GatewayUniversalRequest } from "../Binding";

/** Which provider module and method an `AiError` is reported from. */
export interface Origin {
  /** The provider module name (`AiError.module`), e.g. `"Cohere"`. */
  readonly module: string;
  /** The service method (`AiError.method`), e.g. `"rerank"`. */
  readonly method: string;
}

/**
 * What one gateway call came to, for a caller keeping a cost / latency ledger:
 * the HTTP status (`undefined` when the transport failed before a response),
 * the wall-clock time from sending the request to decoding (or failing to
 * decode) the response, and the `AiError` the call failed with, if it did.
 */
export interface GatewayCall {
  readonly status: number | undefined;
  readonly durationMillis: number;
  readonly error: AiError.AiError | undefined;
}

/** Observes each gateway call once it settles; see {@link GatewayCall}. */
export type OnGatewayCall = (call: GatewayCall) => Effect.Effect<void>;

/** Builds the `AiError` this pipeline reports for one reason. */
const failure = (origin: Origin, reason: AiError.AiErrorReason): AiError.AiError =>
  AiError.make({ module: origin.module, method: origin.method, reason });

/**
 * A response normalised to the shape both transports can produce, so the
 * status/body/schema decode pipeline is shared. `text` is best-effort (never
 * fails; falls back to `""`) since it's used only for an error-body
 * description, and `json` already carries the `AiError` reported for a
 * body-read failure.
 */
interface NormalizedResponse {
  readonly status: number;
  readonly text: Effect.Effect<string>;
  readonly json: Effect.Effect<unknown, AiError.AiError>;
}

/** Wraps a body-read failure (JSON parse, stream error) as the shared `UnknownError` shape. */
const bodyReadFailure = (origin: Origin, cause: unknown): AiError.AiError =>
  failure(
    origin,
    new AiError.UnknownError({
      description: `${origin.module} ${origin.method} response body: ${String(cause)}`,
    }),
  );

/** Wraps a rejected transport call as the shared `UnknownError` shape. */
const transportFailure = (origin: Origin, cause: unknown): AiError.AiError =>
  failure(
    origin,
    new AiError.UnknownError({
      description: `${origin.module} ${origin.method} gateway call failed: ${String(cause)}`,
    }),
  );

/**
 * Decodes a {@link NormalizedResponse} against a schema: non-2xx statuses
 * map through `AiError.reasonFromHttpStatus` (with the response body as the
 * description), then the JSON body is decoded and a mismatch becomes
 * `InvalidOutputError`.
 */
const decodeResponse = <S extends Schema.Top>(
  origin: Origin,
  response: Effect.Effect<NormalizedResponse, AiError.AiError>,
  schema: S,
  onCall: OnGatewayCall | undefined,
): Effect.Effect<S["Type"], AiError.AiError, S["DecodingServices"]> =>
  onCall === undefined
    ? decodeNormalized(origin, response, schema)
    : observed(origin, response, schema, onCall);

/**
 * {@link decodeNormalized}, timed, with the status it saw and its outcome
 * reported to `onCall` before the result is returned.
 */
const observed = <S extends Schema.Top>(
  origin: Origin,
  response: Effect.Effect<NormalizedResponse, AiError.AiError>,
  schema: S,
  onCall: OnGatewayCall,
): Effect.Effect<S["Type"], AiError.AiError, S["DecodingServices"]> =>
  Effect.gen(function* () {
    const status = yield* Ref.make<number | undefined>(undefined);
    const [duration, exit] = yield* decodeNormalized(
      origin,
      response.pipe(Effect.tap((res) => Ref.set(status, res.status))),
      schema,
    ).pipe(Effect.exit, Effect.timed);
    yield* onCall({
      status: yield* Ref.get(status),
      durationMillis: Duration.toMillis(duration),
      error: Option.getOrUndefined(Exit.findErrorOption(exit)),
    });
    return yield* exit;
  });

const decodeNormalized = <S extends Schema.Top>(
  origin: Origin,
  response: Effect.Effect<NormalizedResponse, AiError.AiError>,
  schema: S,
): Effect.Effect<S["Type"], AiError.AiError, S["DecodingServices"]> =>
  response.pipe(
    Effect.flatMap((res) =>
      res.status >= 200 && res.status < 300
        ? Effect.succeed(res)
        : res.text.pipe(
            Effect.flatMap((body) =>
              Effect.fail(
                failure(
                  origin,
                  AiError.reasonFromHttpStatus({ status: res.status, description: body }),
                ),
              ),
            ),
          ),
    ),
    Effect.flatMap((res) => res.json),
    Effect.flatMap((json) =>
      Schema.decodeUnknownEffect(schema)(json).pipe(
        Effect.mapError((error) =>
          failure(
            origin,
            new AiError.InvalidOutputError({
              description: `${origin.module} ${origin.method} response did not match the expected shape: ${String(error)}`,
            }),
          ),
        ),
      ),
    ),
  );

/**
 * Runs one request through the gateway's Worker-binding universal `run()`
 * endpoint and decodes the JSON response against a schema. `onCall`, when
 * given, observes the call once it settles.
 */
export const requestViaBinding = <S extends Schema.Top>(
  origin: Origin,
  binding: GatewayBinding,
  data: GatewayUniversalRequest,
  schema: S,
  onCall?: OnGatewayCall,
): Effect.Effect<S["Type"], AiError.AiError, S["DecodingServices"]> =>
  decodeResponse(
    origin,
    gatewayRun(binding, data).pipe(
      Effect.mapError((cause) => transportFailure(origin, cause)),
      Effect.map((response): NormalizedResponse => ({
        status: response.status,
        text: Effect.tryPromise(() => response.text()).pipe(Effect.orElseSucceed(() => "")),
        json: Effect.tryPromise({
          try: () => response.json(),
          catch: (cause) => bodyReadFailure(origin, cause),
        }),
      })),
    ),
    schema,
    onCall,
  );

/**
 * POSTs one JSON request to a gateway HTTPS URL through an already-resolved
 * `HttpClient.HttpClient` and decodes the JSON response against a schema.
 * Callers precompute the URL and headers once at construction time, not on
 * every request. `onCall`, when given, observes the call once it settles.
 *
 * Goes through Effect's `HttpClient`/`FetchHttpClient`, which is already
 * interruption-safe (the lesson `Binding.ts`'s `gatewayRun` applies manually
 * via a declared `signal`) — no manual signal plumbing needed here.
 */
export const requestViaUrl = <S extends Schema.Top>(
  origin: Origin,
  httpClient: HttpClient.HttpClient,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  schema: S,
  onCall?: OnGatewayCall,
): Effect.Effect<S["Type"], AiError.AiError, S["DecodingServices"]> => {
  const request = HttpClientRequest.post(url, { body: HttpBody.jsonUnsafe(body) }).pipe(
    HttpClientRequest.setHeaders(headers),
  );
  return decodeResponse(
    origin,
    httpClient.execute(request).pipe(
      Effect.mapError((cause) => transportFailure(origin, cause)),
      Effect.map((response): NormalizedResponse => ({
        status: response.status,
        text: response.text.pipe(Effect.orElseSucceed(() => "")),
        json: response.json.pipe(Effect.mapError((cause) => bodyReadFailure(origin, cause))),
      })),
    ),
    schema,
    onCall,
  );
};
