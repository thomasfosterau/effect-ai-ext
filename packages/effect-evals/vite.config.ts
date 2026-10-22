import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 99, // 99.07
  branches: 94, // 94.05
  functions: 99, // 99.68
  statements: 98, // 98.68
};

// Two entries: the barrel (`dist/index.js`) and the CLI (`dist/cli/main.js`),
// which `bin/effect-evals.js` runs. The CLI MUST be built: Node refuses to
// type-strip anything under `node_modules` (issue #42), so a raw-TypeScript
// bin only ever worked inside the workspace. Code splitting puts the modules
// the two entries share in common chunks, so the library an `*.eval.ts` file
// imports by package name and the one the CLI runs are the same module
// instances (one `Cache` service tag, not two).
export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts", "cli/main": "src/cli/main.ts" },
  // A thin, side-effecting entry point; its parts are covered directly.
  coverageExclude: ["src/cli/main.ts"],
});
