/**
 * The one sanctioned way for a test to hand code under test a value that
 * breaks its declared type.
 *
 * Eval files are type-stripped by Node, never type-checked, so a consumer can
 * reach a public function with a value its signature rules out (a non-string
 * `cwd`, a `null` case field, an unknown evaluation param). A test that pins
 * the failure path for such a value routes it through {@link unsafeCoerce}, so
 * every deliberate type break is a named, greppable call rather than an
 * `as unknown as T` chain.
 *
 * @module tests/helpers/unsafe
 */

// SAFETY: test-only. The caller deliberately passes a value that is not a `T`
// in order to reach a failure path an untyped (type-stripped) caller can
// reach; the code under test is expected to reject it, not to rely on it.
/** Returns `value` typed as `T` without checking it. Test inputs only. */
export const unsafeCoerce = <T>(value: unknown): T => value as T;
