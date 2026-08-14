/**
 * @copyright Thomas Foster
 *
 * Loads one `*.eval.ts` file's default export and validates it against the
 * {@link EvalFile.EvalFile} contract. The dynamic `import()` is a plain
 * Node/V8 one — under the real CLI (`bin/effect-evals.js`), Node's
 * Node's default type stripping plus this package's `./loader.mjs`
 * resolution hook are already active process-wide by the time this runs, so
 * the file's own TypeScript and extensionless imports resolve the same way
 * this package's own source does. Under a test runner (vitest),
 * the bundler's own module loader handles it instead — this function itself
 * has no Node-flag dependency, only `import()`.
 *
 * @module cli/LoadEvalFile
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as EvalFile from "../EvalFile.ts";

/** The dynamic `import()` of an eval file threw (syntax error, missing file, a throwing top-level side effect, …). */
export class EvalFileImportError extends Schema.TaggedError<EvalFileImportError>()(
  "EvalFileImportError",
  {
    file: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** An eval file's default export doesn't match the {@link EvalFile.EvalFile} contract. */
export class InvalidEvalFileError extends Schema.TaggedError<InvalidEvalFileError>()(
  "InvalidEvalFileError",
  {
    file: Schema.String,
    reason: Schema.String,
  },
) {}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isAnySuite = (value: unknown): value is EvalFile.AnySuite =>
  isPlainObject(value) &&
  typeof value.name === "string" &&
  isPlainObject(value.dataset) &&
  isPlainObject(value.task) &&
  Array.isArray(value.metrics);

/** Validates a loaded module's default export against the {@link EvalFile.EvalFile} contract, or gives a reason it doesn't. */
export const validateEvalFile = (value: unknown): value is EvalFile.EvalFile => {
  if (!isPlainObject(value)) return false;
  const candidate = value as Partial<EvalFile.EvalFile>;
  if (!Array.isArray(candidate.suites) || !candidate.suites.every(isAnySuite)) return false;
  if (!Layer.isLayer(candidate.layer)) return false;
  if (candidate.options !== undefined && !isPlainObject(candidate.options)) return false;
  return true;
};

const describeInvalid = (value: unknown): string => {
  if (!isPlainObject(value)) {
    return "default export must be an object with { suites, layer, options? }";
  }
  const candidate = value as Partial<EvalFile.EvalFile>;
  if (!Array.isArray(candidate.suites)) return 'default export\'s "suites" must be an array';
  if (!candidate.suites.every(isAnySuite)) {
    return 'default export\'s "suites" must contain only Runner.Suite values (from Runner.makeSuite)';
  }
  if (!Layer.isLayer(candidate.layer))
    return 'default export\'s "layer" must be a Layer (from Layer.*)';
  return 'default export\'s "options", if present, must be an object';
};

/** Dynamically imports `file` and validates its default export against the eval-file contract. */
export const loadEvalFile = (
  file: string,
): Effect.Effect<EvalFile.EvalFile, EvalFileImportError | InvalidEvalFileError> =>
  Effect.gen(function* () {
    const url = pathToFileURL(path.resolve(file)).href;
    const moduleExports = yield* Effect.tryPromise({
      try: () => import(/* @vite-ignore */ url),
      catch: (cause) => new EvalFileImportError({ file, cause }),
    });

    const candidate: unknown = moduleExports.default;
    if (!validateEvalFile(candidate)) {
      return yield* new InvalidEvalFileError({ file, reason: describeInvalid(candidate) });
    }
    return candidate;
  });
