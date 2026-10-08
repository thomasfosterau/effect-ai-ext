import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 97, // 97.14
  branches: 86, // 86.9
  functions: 98, // 98.38
  statements: 97, // 97.17
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
