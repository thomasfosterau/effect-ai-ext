import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 95, // 95.15
  branches: 80, // 80.37
  functions: 93, // 93.84
  statements: 95, // 95.25
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
