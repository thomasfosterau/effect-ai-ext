/**
 * Effect test helpers for the unit suite.
 *
 * Two small wrappers around `Effect.runPromise` / `runPromiseExit`, plus a
 * failure-type assertion. Provide layers per test with `Effect.provide` at the
 * call site, per the effect-solutions testing guide:
 *
 * ```ts
 * const exit = await runTestExit(program.pipe(Effect.provide(layer)));
 * ```
 *
 * @module tests/helpers/effect
 */

import { assert, expect } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

/** Run a fully-provided Effect to a Promise of its success value. */
export const runTest = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(effect);

/** Run a fully-provided Effect to its `Exit`, for failure-path assertions. */
export const runTestExit = <A, E>(effect: Effect.Effect<A, E, never>): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(effect);

/**
 * Run a fully-provided Effect expected to fail with an instance of the
 * given error class; returns the failure so callers can assert on its
 * fields.
 */
export const expectFailureInstanceOf = async <A, E, T>(
  program: Effect.Effect<A, E, never>,
  errorClass: abstract new (...args: never[]) => T,
): Promise<T> => {
  const exit = await runTestExit(program);

  expect(Exit.isFailure(exit)).toBe(true);
  assert(Exit.isFailure(exit), "Expected a failure exit");
  const found = Cause.findErrorOption(exit.cause);
  assert(Option.isSome(found), "Expected a typed failure in the cause");
  const failure = found.value;
  expect(failure).toBeInstanceOf(errorClass);
  assert(failure instanceof errorClass);
  return failure;
};

/** A span captured by {@link recordingTracer}: its name and its attributes. */
export interface RecordedSpan {
  readonly name: string;
  readonly attributes: Map<string, unknown>;
}

/** A {@link Tracer.Tracer} and the spans it has recorded so far. */
export interface RecordingTracer {
  readonly tracer: Tracer.Tracer;
  readonly spans: RecordedSpan[];
}

/**
 * A recording {@link Tracer.Tracer} plus the list of spans it captured, for
 * asserting that an Effect creates the expected `Effect.withSpan(...)` spans
 * (read-path instrumentation, #538 / #739). Provide the tracer with
 * `Effect.provideService(Tracer.Tracer, tracer)`; every `withSpan` on the
 * program then appends to `spans` in creation order.
 *
 * `makeSpanUnsafe` invokes `tracer.span(...)` whenever tracing is enabled
 * (the default) — independent of the sampling decision — so a span is
 * recorded for each instrumented phase even though nothing is exported.
 */
export const recordingTracer = (): RecordingTracer => {
  const spans: RecordedSpan[] = [];
  const tracer = Tracer.make({
    span(options) {
      const attributes = new Map<string, unknown>();
      spans.push({ name: options.name, attributes });
      const span: Tracer.Span = {
        _tag: "Span",
        name: options.name,
        spanId: `recorded-${spans.length}`,
        traceId: "recorded-trace",
        parent: options.parent,
        annotations: options.annotations,
        status: { _tag: "Started", startTime: options.startTime },
        attributes,
        links: options.links,
        sampled: options.sampled,
        kind: options.kind,
        end() {},
        attribute(key, value) {
          attributes.set(key, value);
        },
        event() {},
        addLinks() {},
      };
      return span;
    },
  });
  return { tracer, spans };
};
