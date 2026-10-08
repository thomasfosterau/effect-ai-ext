/**
 * Unit tests for `ToolCallCorrectness.toolCallCorrectness`. The option-matrix
 * suite exercises every combination of `mode` (exact/subset), `ordered`
 * (true/false), and `matchParams` (true/false) against one shared scenario
 * designed so each knob changes the outcome: `search`'s actual params differ
 * from its expected params, `lookup` appears before `search` in the actual
 * call order (defeating the expected search-then-lookup sequence when
 * `ordered` is set), and an unrelated `extra` call is always present.
 *
 * @module tests/scorers/tool-call-correctness
 */

import { describe, expect, it } from "vite-plus/test";
import { ToolCallCorrectness } from "../../src/index.ts";
import { runTest } from "../helpers/effect.ts";

const EXPECTED = [
  { name: "search", params: { query: "cats" } },
  { name: "lookup", params: { id: 1 } },
];

// `lookup` precedes `search` (reversed from EXPECTED's order), `search`'s
// params don't match, and `extra` is never expected.
const ACTUAL = [
  { name: "lookup", params: { id: 1 } },
  { name: "extra", params: {} },
  { name: "search", params: { query: "dogs" } },
];

const evaluateOptions = (options: Parameters<typeof ToolCallCorrectness.toolCallCorrectness>[0]) =>
  runTest(
    ToolCallCorrectness.toolCallCorrectness(options).evaluate({
      golden: { expectedTools: EXPECTED },
      toolCalls: ACTUAL,
    }),
  );

describe("ToolCallCorrectness.toolCallCorrectness — option matrix", () => {
  it("subset, unordered, name-only: both expected tools found, extra ignored", async () => {
    const score = await evaluateOptions({ mode: "subset", ordered: false, matchParams: false });
    expect(score.score).toBe(1);
    expect(score.reason).toBe("unexpected: extra");
  });

  it("subset, unordered, params must match: search's params mismatch, lookup still found", async () => {
    const score = await evaluateOptions({ mode: "subset", ordered: false, matchParams: true });
    expect(score.score).toBe(0.5);
    expect(score.reason).toBe("missing: search; unexpected: extra, search");
  });

  it("subset, ordered, name-only: lookup appears before search in actual, so only search matches", async () => {
    const score = await evaluateOptions({ mode: "subset", ordered: true, matchParams: false });
    expect(score.score).toBe(0.5);
    expect(score.reason).toBe("missing: lookup; unexpected: lookup, extra");
  });

  it("subset, ordered, params must match: only lookup matches (search's params also mismatch)", async () => {
    const score = await evaluateOptions({ mode: "subset", ordered: true, matchParams: true });
    expect(score.score).toBe(0.5);
    expect(score.reason).toBe("missing: search; unexpected: extra, search");
  });

  it("exact, unordered, name-only: both expected tools found, but the extra call fails exact mode", async () => {
    const score = await evaluateOptions({ mode: "exact", ordered: false, matchParams: false });
    expect(score.score).toBe(0);
    expect(score.reason).toBe("unexpected: extra");
  });

  it("exact, unordered, params must match: search unmatched, so exact mode fails", async () => {
    const score = await evaluateOptions({ mode: "exact", ordered: false, matchParams: true });
    expect(score.score).toBe(0);
    expect(score.reason).toBe("missing: search; unexpected: extra, search");
  });

  it("exact, ordered, name-only: out-of-order lookup fails exact mode", async () => {
    const score = await evaluateOptions({ mode: "exact", ordered: true, matchParams: false });
    expect(score.score).toBe(0);
    expect(score.reason).toBe("missing: lookup; unexpected: lookup, extra");
  });

  it("exact, ordered, params must match: fails on both ordering and params", async () => {
    const score = await evaluateOptions({ mode: "exact", ordered: true, matchParams: true });
    expect(score.score).toBe(0);
    expect(score.reason).toBe("missing: search; unexpected: extra, search");
  });
});

describe("ToolCallCorrectness.toolCallCorrectness — edge cases", () => {
  it("scores a perfect match as 1 under exact mode with no leftovers", async () => {
    const score = await runTest(
      ToolCallCorrectness.toolCallCorrectness({ mode: "exact", ordered: true }).evaluate({
        golden: { expectedTools: [{ name: "search" }, { name: "lookup" }] },
        toolCalls: [
          { name: "search", params: { query: "cats" } },
          { name: "lookup", params: { id: 1 } },
        ],
      }),
    );
    expect(score).toEqual({ score: 1, reason: undefined });
  });

  it("prefers matching a params-constrained expected entry before a bare one for the same tool, unordered", async () => {
    // Without a specificity-aware processing order, the bare `A` entry would
    // greedily claim actual[0] (any params satisfy it), leaving the
    // params-constrained `A` entry unable to match actual[1]'s params —
    // an achievable full match would be under-scored.
    const score = await runTest(
      ToolCallCorrectness.toolCallCorrectness({ matchParams: true }).evaluate({
        golden: { expectedTools: [{ name: "A" }, { name: "A", params: { x: 1 } }] },
        toolCalls: [
          { name: "A", params: { x: 1 } },
          { name: "A", params: { x: 2 } },
        ],
      }),
    );
    expect(score).toEqual({ score: 1, reason: undefined });
  });

  it("accepts plain tool-name strings, matching Golden.Golden's expectedTools shape", async () => {
    const score = await runTest(
      ToolCallCorrectness.toolCallCorrectness().evaluate({
        golden: { expectedTools: ["search", "lookup"] },
        toolCalls: [
          { name: "search", params: { query: "cats" } },
          { name: "lookup", params: { id: 1 } },
        ],
      }),
    );
    expect(score.score).toBe(1);
  });

  it("treats a bare string entry as name-only even when matchParams is set", async () => {
    const score = await runTest(
      ToolCallCorrectness.toolCallCorrectness({ matchParams: true }).evaluate({
        golden: { expectedTools: ["search"] },
        toolCalls: [{ name: "search", params: { query: "anything" } }],
      }),
    );
    expect(score.score).toBe(1);
  });

  it("deep-compares array-valued params, not just object-valued ones", async () => {
    const matching = await runTest(
      ToolCallCorrectness.toolCallCorrectness({ matchParams: true }).evaluate({
        golden: { expectedTools: [{ name: "search", params: ["cats", "dogs"] }] },
        toolCalls: [{ name: "search", params: ["cats", "dogs"] }],
      }),
    );
    expect(matching.score).toBe(1);

    const differentLength = await runTest(
      ToolCallCorrectness.toolCallCorrectness({ matchParams: true }).evaluate({
        golden: { expectedTools: [{ name: "search", params: ["cats", "dogs"] }] },
        toolCalls: [{ name: "search", params: ["cats"] }],
      }),
    );
    expect(differentLength.score).toBe(0);

    const arrayVsObject = await runTest(
      ToolCallCorrectness.toolCallCorrectness({ matchParams: true }).evaluate({
        golden: { expectedTools: [{ name: "search", params: ["cats"] }] },
        toolCalls: [{ name: "search", params: { 0: "cats" } }],
      }),
    );
    expect(arrayVsObject.score).toBe(0);
  });

  it("distinguishes different Date-valued params (Equal.equals, not a plain-object key comparison)", async () => {
    const same = await runTest(
      ToolCallCorrectness.toolCallCorrectness({ matchParams: true }).evaluate({
        golden: { expectedTools: [{ name: "schedule", params: { at: new Date("2026-01-01") } }] },
        toolCalls: [{ name: "schedule", params: { at: new Date("2026-01-01") } }],
      }),
    );
    expect(same.score).toBe(1);

    const different = await runTest(
      ToolCallCorrectness.toolCallCorrectness({ matchParams: true }).evaluate({
        golden: { expectedTools: [{ name: "schedule", params: { at: new Date("2026-01-01") } }] },
        toolCalls: [{ name: "schedule", params: { at: new Date("2026-06-01") } }],
      }),
    );
    expect(different.score).toBe(0);
  });

  it("scores 1 (trivially) when no tools are expected", async () => {
    const score = await runTest(
      ToolCallCorrectness.toolCallCorrectness().evaluate({ golden: {}, toolCalls: [] }),
    );
    expect(score).toEqual({ score: 1, reason: undefined });
  });

  it("defaults to subset, unordered, name-only when called with no options", async () => {
    const withDefaults = await runTest(
      ToolCallCorrectness.toolCallCorrectness().evaluate({
        golden: { expectedTools: EXPECTED },
        toolCalls: ACTUAL,
      }),
    );
    const explicit = await evaluateOptions({ mode: "subset", ordered: false, matchParams: false });
    expect(withDefaults).toEqual(explicit);
  });

  it("treats a missing toolCalls array as no actual calls", async () => {
    const score = await runTest(
      ToolCallCorrectness.toolCallCorrectness().evaluate({
        golden: { expectedTools: ["search"] },
      }),
    );
    expect(score).toEqual({ score: 0, reason: "missing: search" });
  });
});
