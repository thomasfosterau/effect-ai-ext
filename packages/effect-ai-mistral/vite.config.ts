import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 95, // 95.4
  branches: 81, // 81.25 (#121)
  functions: 94, // 94.05
  statements: 95, // 95.46
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
