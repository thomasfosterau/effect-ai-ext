import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the last measured % (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 96, // 96.47
  branches: 81, // 81.25
  functions: 94, // 94.44
  statements: 96, // 96.57
};

export default packageConfig({
  coverageFloor,
  entry: { index: "src/index.ts" },
});
