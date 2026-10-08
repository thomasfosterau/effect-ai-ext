import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 90, // 90.21
  branches: 69, // 69.6
  functions: 93, // 93.22
  statements: 90, // 90.37
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
