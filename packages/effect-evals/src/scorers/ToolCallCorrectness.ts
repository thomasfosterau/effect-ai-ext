/**
 * `toolCallCorrectness` — deterministic comparison of a case's actual
 * `toolCalls` (`EvalCase.ToolCall`) against its golden's `expectedTools`,
 * mirroring DeepEval's `ToolCorrectnessMetric` knobs: `mode` (`"exact"` — the
 * actual calls must equal the expected set/sequence with nothing missing and
 * nothing extra — vs `"subset"`, the default — every expected call must
 * appear among the actual calls, extras ignored), `ordered` (whether the
 * expected calls must appear as an in-order subsequence of the actual
 * calls), and `matchParams` (whether a matched call's `params` must also
 * deep-equal the expected call's, not just its `name`).
 *
 * `Golden.Golden`'s `expectedTools` field is a plain `ReadonlyArray<string>`
 * (tool names only) — this module accepts that directly, and additionally
 * accepts richer {@link ExpectedToolCall} entries (`name` + `params`) for
 * callers who compose their own golden schema with per-call expected
 * parameters, which `matchParams` needs to do anything useful. A bare
 * `string` entry always matches on name alone, regardless of `matchParams`.
 *
 * Never fails — deterministic comparison has no failure mode of its own.
 *
 * @module scorers/ToolCallCorrectness
 *
 * @copyright Thomas Foster
 */

import * as Order from "effect/Order";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Equal from "effect/Equal";
import type { ToolCall } from "../EvalCase.ts";
import * as Scorer from "../Scorer.ts";

/** One tool call a golden expects, mirroring `EvalCase.ToolCall`'s `name`/`params` shape without an actual `result` (nothing has run yet). */
export interface ExpectedToolCall {
  readonly name: string;
  readonly params?: unknown;
}

/** The shape `toolCallCorrectness` needs from a case: expected tool calls on the golden, actual tool calls on the case. */
export interface ToolCallCorrectnessCase {
  readonly golden: {
    readonly expectedTools?: ReadonlyArray<string | ExpectedToolCall>;
  };
  readonly toolCalls?: ReadonlyArray<ToolCall>;
}

/** How strictly {@link toolCallCorrectness} compares actual tool calls against expected ones. */
export interface ToolCallCorrectnessOptions {
  /** `"subset"` (default): every expected call must be found among the actual calls; extra actual calls are ignored. `"exact"`: the actual calls must match the expected set/sequence exactly — no extras, no missing calls. */
  readonly mode?: "exact" | "subset";
  /** Whether the expected calls must appear as an in-order subsequence of the actual calls. Default `false`. */
  readonly ordered?: boolean;
  /** Whether a matched call's `params` must also deep-equal the expected call's. Default `false`. */
  readonly matchParams?: boolean;
}

const normalizeExpected = (entry: string | ExpectedToolCall): ExpectedToolCall =>
  Predicate.isString(entry) ? { name: entry } : entry;

/**
 * `matchParams` only applies when the expected call actually declares
 * `params` — a bare tool name (or an `ExpectedToolCall` with `params`
 * omitted) has nothing to compare against, so it matches on name alone
 * regardless of `matchParams`. Params equality is `Equal.equals`'s
 * structural comparison (handles plain objects/arrays, `Date`, `RegExp`,
 * `Map`, `Set` — not just the plain-object/array shapes a hand-rolled
 * comparison would need to special-case correctly).
 */
const callMatches = (expected: ExpectedToolCall, actual: ToolCall, matchParams: boolean): boolean =>
  expected.name === actual.name &&
  (!matchParams || expected.params === undefined || Equal.equals(expected.params, actual.params));

interface MatchResult {
  readonly matchedCount: number;
  readonly unmatchedExpected: ReadonlyArray<ExpectedToolCall>;
  readonly extraActual: ReadonlyArray<ToolCall>;
}

/**
 * The order `matchToolCalls` visits `expected` entries in. Ordered mode must
 * keep `expected`'s given order (its cursor-based scan depends on it being a
 * candidate subsequence position). Unordered mode is free to choose, so it
 * visits params-constrained entries before bare ones: with `matchParams`, a
 * bare entry matches *any* actual call by that name, while a
 * params-constrained entry only matches one with equal params, so claiming
 * the constrained match first avoids the bare entry accidentally consuming
 * the one actual call the constrained entry needed (a specificity
 * heuristic, not a full assignment-problem solve — an adversarial mix of
 * several same-name entries with overlapping constraints could still find a
 * sub-optimal assignment, but the common "one specific call plus one
 * generic call" shape is handled correctly).
 */
const processingOrder = (
  expected: ReadonlyArray<ExpectedToolCall>,
  options: { readonly ordered: boolean; readonly matchParams: boolean },
): ReadonlyArray<readonly [index: number, call: ExpectedToolCall]> => {
  const entries = Arr.map(expected, (call, index) => [index, call] as const);
  if (options.ordered || !options.matchParams) {
    return entries;
  }
  // Calls that pin params first (a stable sort keeps each group's order).
  return Arr.sort(
    entries,
    Order.mapInput(
      Order.flip(Order.Boolean),
      ([, call]: readonly [number, ExpectedToolCall]) => call.params !== undefined,
    ),
  );
};

/** The first unconsumed `actual` index (from `searchFrom` onward) matching `expectedCall`. */
const findMatch = (
  expectedCall: ExpectedToolCall,
  actual: ReadonlyArray<ToolCall>,
  consumed: ReadonlyArray<boolean>,
  searchFrom: number,
  matchParams: boolean,
): Option.Option<number> =>
  Arr.findFirstIndex(
    actual,
    (call, index) =>
      index >= searchFrom && !consumed[index] && callMatches(expectedCall, call, matchParams),
  );

/**
 * Greedily consumes `actual` entries against `expected`, in
 * {@link processingOrder}. Ordered mode scans forward from the previous
 * match, so a matched expected sequence must appear as an in-order
 * subsequence of `actual` (gaps from unmatched entries don't reset the
 * cursor) — a bare (name-only) entry can still pre-empt a later
 * params-constrained entry for the same tool name in `ordered` mode, since
 * reordering isn't an option there without breaking the subsequence
 * guarantee.
 */
const matchToolCalls = (
  expected: ReadonlyArray<ExpectedToolCall>,
  actual: ReadonlyArray<ToolCall>,
  options: { readonly ordered: boolean; readonly matchParams: boolean },
): MatchResult => {
  const consumed = Array.from<boolean>({ length: actual.length }).fill(false);
  const matched = Array.from<boolean>({ length: expected.length }).fill(false);

  Arr.reduce(processingOrder(expected, options), 0, (cursor, [index, call]) => {
    const searchFrom = options.ordered ? cursor : 0;
    return Option.match(findMatch(call, actual, consumed, searchFrom, options.matchParams), {
      onNone: () => cursor,
      onSome: (foundIndex) => {
        consumed[foundIndex] = true;
        matched[index] = true;
        return options.ordered ? foundIndex + 1 : cursor;
      },
    });
  });

  const unmatchedExpected = expected.filter((_, index) => !matched[index]);
  const extraActual = actual.filter((_, index) => !consumed[index]);
  return {
    matchedCount: matched.filter(Boolean).length,
    unmatchedExpected,
    extraActual,
  };
};

const describeMismatches = (
  unmatchedExpected: ReadonlyArray<ExpectedToolCall>,
  extraActual: ReadonlyArray<ToolCall>,
): string | undefined => {
  const parts: string[] = [];
  if (Arr.isReadonlyArrayNonEmpty(unmatchedExpected)) {
    parts.push(`missing: ${unmatchedExpected.map((call) => call.name).join(", ")}`);
  }
  if (Arr.isReadonlyArrayNonEmpty(extraActual)) {
    parts.push(`unexpected: ${extraActual.map((call) => call.name).join(", ")}`);
  }
  return Arr.isReadonlyArrayNonEmpty(parts) ? parts.join("; ") : undefined;
};

/** Builds a scorer comparing `evalCase.toolCalls` against `evalCase.golden.expectedTools` under the given {@link ToolCallCorrectnessOptions}. */
export const toolCallCorrectness = (
  options: ToolCallCorrectnessOptions = {},
): Scorer.Scorer<ToolCallCorrectnessCase> => {
  const mode = options.mode ?? "subset";
  const ordered = options.ordered ?? false;
  const matchParams = options.matchParams ?? false;

  return Scorer.makeScorer({
    name: "tool-call-correctness",
    evaluate: (evalCase) =>
      Effect.sync(() => {
        const expected = (evalCase.golden.expectedTools ?? []).map(normalizeExpected);
        const actual = evalCase.toolCalls ?? [];
        const { matchedCount, unmatchedExpected, extraActual } = matchToolCalls(expected, actual, {
          ordered,
          matchParams,
        });
        const reason = describeMismatches(unmatchedExpected, extraActual);

        if (mode === "exact") {
          const isExact =
            Arr.isReadonlyArrayEmpty(unmatchedExpected) && Arr.isReadonlyArrayEmpty(extraActual);
          return { score: isExact ? 1 : 0, reason };
        }

        const score = Arr.isReadonlyArrayEmpty(expected) ? 1 : matchedCount / expected.length;
        return { score, reason };
      }),
  });
};
