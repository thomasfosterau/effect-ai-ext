import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 94, // 94.6
  branches: 78, // 78.12
  functions: 92, // 92.38
  statements: 94, // 94.65
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
