import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the last measured % (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 95, // 95.87 (#121)
  branches: 81, // 81.25 (#121)
  functions: 94, // 94.05 (#121)
  statements: 95, // 95.98 (#121)
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
