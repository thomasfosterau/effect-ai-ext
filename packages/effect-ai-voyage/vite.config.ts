import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 98, // 98.78
  branches: 80, // 80.76
  functions: 97, // 97.5
  statements: 98, // 98.8
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
