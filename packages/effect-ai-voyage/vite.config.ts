import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 96, // 96.25
  branches: 74, // 74.19
  functions: 94, // 94.28
  statements: 96, // 96.29
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
