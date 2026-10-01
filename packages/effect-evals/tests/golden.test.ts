/**
 * Schema round-trip tests for `Golden` / `ConversationalGolden` / `EvalCase`.
 *
 * @module tests/golden
 */

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Prompt from "effect/ai/Prompt";
import { EvalCase, Golden } from "../src/index.ts";
import { runTest, expectFailureInstanceOf } from "./helpers/effect.ts";

describe("Golden", () => {
  const TranslationGolden = Golden.Golden(Schema.String, Schema.String);

  it("round-trips a single-turn golden through decode/encode", async () => {
    const input = {
      input: "Bonjour le monde",
      expected: "Hello world",
      context: ["greeting"],
      metadata: { locale: "fr" },
    };

    const decoded = await runTest(Schema.decodeUnknownEffect(TranslationGolden)(input));
    expect(decoded.input).toBe("Bonjour le monde");
    expect(decoded.expected).toBe("Hello world");
    expect(decoded.context).toEqual(["greeting"]);
    expect(decoded.metadata).toEqual({ locale: "fr" });
    expect(decoded).not.toHaveProperty("expectedTools");

    const encoded = await runTest(Schema.encodeEffect(TranslationGolden)(decoded));
    // Structural equality, not JSON.stringify equality — the latter also
    // pins key iteration order, which is not part of the contract.
    expect(encoded).toEqual(input);
  });

  it("allows omitting optional fields, dropping their keys rather than encoding `undefined`", async () => {
    const decoded = await runTest(
      Schema.decodeUnknownEffect(TranslationGolden)({ input: "Bonjour" }),
    );
    expect(decoded.input).toBe("Bonjour");
    expect(decoded.expected).toBeUndefined();

    const encoded = await runTest(Schema.encodeEffect(TranslationGolden)(decoded));
    expect(Object.keys(encoded)).toEqual(["input"]);
  });

  it("fails to decode a golden missing its required input", async () => {
    await expectFailureInstanceOf(
      Schema.decodeUnknownEffect(TranslationGolden)({ expected: "Hello" }).pipe(Effect.asVoid),
      Schema.SchemaError,
    );
  });
});

describe("ConversationalGolden", () => {
  const SupportGolden = Golden.ConversationalGolden(Schema.String);

  it("round-trips a multi-turn golden whose turns align with Prompt", async () => {
    const prompt = Prompt.make([
      { role: "user", content: "My order hasn't arrived" },
      { role: "assistant", content: "Can you share the order number?" },
    ]);

    const decoded = await runTest(
      Schema.decodeUnknownEffect(SupportGolden)(
        await runTest(
          Schema.encodeEffect(SupportGolden)({
            turns: prompt,
            scenario: "delayed-order",
            expectedOutcome: "asks for the order number",
            context: undefined,
            metadata: undefined,
          }),
        ),
      ),
    );

    expect(decoded.turns.content).toHaveLength(2);
    expect(decoded.turns.content[0]?.role).toBe("user");
    expect(decoded.turns.content[1]?.role).toBe("assistant");
    expect(decoded.turns.content[1]).toMatchObject({
      content: [{ type: "text", text: "Can you share the order number?" }],
    });
    expect(decoded.scenario).toBe("delayed-order");
    expect(decoded.expectedOutcome).toBe("asks for the order number");
  });
});

describe("EvalCase", () => {
  const TranslationGolden = Golden.Golden(Schema.String, Schema.String);
  const TranslationCase = EvalCase.EvalCase(TranslationGolden, Schema.String);

  it("round-trips a golden enriched with actuals", async () => {
    const golden = await runTest(
      Schema.decodeUnknownEffect(TranslationGolden)({
        input: "Bonjour",
        expected: "Hello",
      }),
    );

    const encoded = await runTest(
      Schema.encodeEffect(TranslationCase)({
        golden,
        output: "Hi",
        retrievedContext: undefined,
        toolCalls: [{ name: "lookupGlossary", params: { term: "Bonjour" }, result: "Hello" }],
        durationMillis: 120,
        usage: { inputTokens: 4, outputTokens: 2 },
      }),
    );

    const decoded = await runTest(Schema.decodeUnknownEffect(TranslationCase)(encoded));
    expect(decoded.golden.input).toBe("Bonjour");
    expect(decoded.output).toBe("Hi");
    expect(decoded.toolCalls?.[0]?.name).toBe("lookupGlossary");
    expect(decoded.durationMillis).toBe(120);
    expect(decoded.usage?.inputTokens).toBe(4);
  });
});
