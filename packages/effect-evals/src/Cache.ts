/**
 * Content-hash result caching, built directly on `effect`'s own
 * `KeyValueStore` (`effect/persistence`): a cache hit lets
 * {@link Runner.runSuite} skip both the task (SUT) call and a metric's judge
 * call for that trial. A task-level key hashes the golden, the task's
 * identifier, and the trial number; a metric-level key adds the metric name
 * and judge model id — so re-running an unchanged suite reproduces the exact
 * same per-trial results, not just the same mean (see
 * {@link Result.MetricAggregate}).
 *
 * Cache invalidation is **manual, by identifier** — the same convention as a
 * cache-busting query string. Neither key hashes a task's `run` closure nor a
 * metric's `scorer`/`threshold` (both are opaque code, not data), so editing
 * a task's behavior or a scorer's judging without bumping its name/id (e.g.
 * `"translate@v1"` → `"translate@v2"`) silently serves a stale cached result.
 * Cached values also round-trip through `JSON.stringify`/`JSON.parse` with no
 * schema check, so a `TaskDefinition`'s `Output` (or a metric's `Score`)
 * containing non-JSON-safe values (`Date`, `Map`, `Set`, class instances)
 * will not survive a cache hit faithfully — stick to plain JSON-shaped data
 * for cached tasks and scorers.
 *
 * Only `effect` and the platform-standard `crypto.subtle` global (present in
 * Node 19+ and Workers, no import needed) are used here, because the
 * package's core depends on `effect` alone (website#922): the
 * concrete `FileSystem`/`Path` layer for {@link layerFileSystem} is supplied
 * by the caller (a test or the CLI) — exactly like a judge `LanguageModel` is
 * provided to a {@link Scorer.Scorer}.
 *
 * @module Cache
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import { KeyValueStore } from "effect/persistence";

export { KeyValueStore };

/** The default cache directory, relative to wherever the runner executes — gitignored. */
export const defaultDirectory = ".effect-evals/cache";

/** A process-local in-memory cache — the default for tests, and for runs with no persistence. */
export const layerMemory = KeyValueStore.layerMemory;

/** A filesystem-backed cache under `directory`, created on first use. */
export const layerFileSystem = KeyValueStore.layerFileSystem;

/**
 * The components a cache key is hashed from: a task-level key (golden + task
 * id + trial) when `metric` is omitted, or a metric-level key (adding the
 * metric name and judge model id) when it's given.
 */
export interface CacheKeyInput {
  readonly golden: unknown;
  readonly taskId: string;
  readonly trial: number;
  readonly metric?: string;
  readonly judgeModelId?: string | undefined;
}

/** A value `canonicalize` hands to `JSON.stringify` as it came. */
type CanonicalLeaf = string | number | boolean | bigint | symbol | null | undefined;

/** {@link canonicalize}'s output: leaves, and arrays and key-sorted records of them. */
type Canonical = CanonicalLeaf | ReadonlyArray<Canonical> | { readonly [key: string]: Canonical };

/** Every value but an object or a function is a {@link CanonicalLeaf}. */
const isCanonicalLeaf = (value: unknown): value is CanonicalLeaf =>
  !Predicate.isObjectKeyword(value);

/**
 * Normalises a value into a plain JSON-compatible shape with every object's
 * keys sorted, so `JSON.stringify` afterwards is stable across key
 * insertion order. Handles `Date`/`Map`/`Set` explicitly — left to
 * `JSON.stringify` directly, all three serialise to `{}` (none exposes its
 * value as an enumerable own property), which would collide two otherwise-
 * distinct cache keys that differ only in one of these fields.
 */
const canonicalize = (value: unknown): Canonical => {
  if (isCanonicalLeaf(value)) return value;
  if (value instanceof Date) return { __date: value.toISOString() };
  if (value instanceof Map)
    return { __map: Array.from(value, ([k, v]) => [canonicalize(k), canonicalize(v)]) };
  if (value instanceof Set) return { __set: Array.from(value, canonicalize) };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (Predicate.isObject(value)) {
    const sorted: Record<string, Canonical> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  // Only a function is left. `JSON.stringify` drops one exactly as it drops
  // `undefined` (an omitted key, a `null` array slot), so the key is unchanged.
  return undefined;
};

const encoder = new TextEncoder();
const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * A deterministic cache key for the given inputs — stable across process
 * runs. A full SHA-256 hex digest (not a 32-bit structural hash — this key
 * addresses entries in a persistent, cross-run filesystem cache, where a
 * small hash's collision odds are a real correctness risk, not just a
 * theoretical one).
 */
export const hashKey = (input: CacheKeyInput): Effect.Effect<string> =>
  Effect.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(JSON.stringify(canonicalize(input))),
      );
      return toHex(digest);
    },
    catch: (cause) => cause,
  }).pipe(
    // An input `JSON.stringify` cannot serialise (a cycle, a `BigInt`) is a
    // caller bug, and SHA-256 over bytes cannot fail, so either is a defect.
    Effect.orDie,
  );
