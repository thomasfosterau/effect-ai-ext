/**
 * Unit tests for `Cache`: deterministic key hashing, and `layerMemory` as a
 * working `KeyValueStore`.
 *
 * @module tests/cache
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { Cache } from "../src/index.ts";
import { runTest } from "./helpers/effect.ts";

describe("Cache.hashKey", () => {
  const base = {
    golden: { input: "Bonjour" },
    taskId: "translate@v1",
    metric: "exact-match",
    judgeModelId: undefined,
    trial: 1,
  };

  const hash = (input: Cache.CacheKeyInput) => runTest(Cache.hashKey(input));

  it("is a full SHA-256 hex digest, not a small structural hash", async () => {
    expect(await hash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical inputs", async () => {
    expect(await hash(base)).toBe(await hash({ ...base }));
  });

  it("is independent of object key order", async () => {
    const reordered = {
      trial: 1,
      metric: "exact-match",
      judgeModelId: undefined,
      taskId: "translate@v1",
      golden: { input: "Bonjour" },
    };
    expect(await hash(base)).toBe(await hash(reordered));
  });

  it("changes when the golden changes", async () => {
    expect(await hash(base)).not.toBe(await hash({ ...base, golden: { input: "Ciao" } }));
  });

  it("changes when the trial changes", async () => {
    expect(await hash(base)).not.toBe(await hash({ ...base, trial: 2 }));
  });

  it("changes when the metric changes", async () => {
    expect(await hash(base)).not.toBe(await hash({ ...base, metric: "other-metric" }));
  });

  it("changes when the judge model id changes", async () => {
    expect(await hash(base)).not.toBe(await hash({ ...base, judgeModelId: "claude-sonnet-5" }));
  });

  it("distinguishes goldens that differ only by a Date field", async () => {
    const withDate = (date: Date) => ({ ...base, golden: { askedAt: date } });
    expect(await hash(withDate(new Date("2026-01-01")))).not.toBe(
      await hash(withDate(new Date("2026-07-16"))),
    );
  });

  it("distinguishes goldens that differ only by a Map's contents", async () => {
    const withMap = (entries: Array<[string, string]>) => ({
      ...base,
      golden: { tags: new Map(entries) },
    });
    expect(await hash(withMap([["a", "1"]]))).not.toBe(await hash(withMap([["a", "2"]])));
  });

  it("distinguishes goldens that differ only by a Set's contents", async () => {
    const withSet = (values: Array<string>) => ({ ...base, golden: { tags: new Set(values) } });
    expect(await hash(withSet(["a"]))).not.toBe(await hash(withSet(["b"])));
  });
});

describe("Cache.layerMemory", () => {
  it("round-trips a set value through get", async () => {
    const value = await runTest(
      Effect.gen(function* () {
        const kv = yield* Cache.KeyValueStore.KeyValueStore;
        yield* kv.set("key", "value");
        return yield* kv.get("key");
      }).pipe(Effect.provide(Cache.layerMemory)),
    );
    expect(value).toBe("value");
  });

  it("returns undefined for a missing key", async () => {
    const value = await runTest(
      Effect.gen(function* () {
        const kv = yield* Cache.KeyValueStore.KeyValueStore;
        return yield* kv.get("missing");
      }).pipe(Effect.provide(Cache.layerMemory)),
    );
    expect(value).toBeUndefined();
  });

  it("starts fresh on every independent run, even from the same layer constant", async () => {
    await runTest(
      Effect.gen(function* () {
        const kv = yield* Cache.KeyValueStore.KeyValueStore;
        yield* kv.set("key", "from-first-run");
      }).pipe(Effect.provide(Cache.layerMemory)),
    );

    const value = await runTest(
      Effect.gen(function* () {
        const kv = yield* Cache.KeyValueStore.KeyValueStore;
        return yield* kv.get("key");
      }).pipe(Effect.provide(Cache.layerMemory)),
    );
    expect(value).toBeUndefined();
  });
});
