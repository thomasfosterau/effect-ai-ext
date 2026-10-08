import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 95, // 95.4
  branches: 78, // 78.94
  functions: 92, // 92.59
  statements: 95, // 95.46
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
