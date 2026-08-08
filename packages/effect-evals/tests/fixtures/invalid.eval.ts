/**
 * @copyright Thomas Foster
 *
 * A fixture whose default export doesn't satisfy the eval-file contract
 * (missing `layer`) — exercises `LoadEvalFile`'s validation and the CLI's
 * "failed to load" reporting, distinct from the credential-gating skip path.
 *
 * @module tests/fixtures/invalid.eval
 */

export default {
  suites: [],
};
