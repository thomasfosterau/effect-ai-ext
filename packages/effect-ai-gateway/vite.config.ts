import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 99, // 99.15
  branches: 100, // 100
  functions: 96, // 96.66
  statements: 98, // 98.46
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
