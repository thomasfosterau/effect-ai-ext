import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet (#100): the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 100, // 100
  branches: 98, // 98.57
  functions: 100, // 100
  statements: 100, // 100
};

// One entry per module (mirrors how `effect` itself ships per-module
// subpaths), matching the subpaths `publishConfig.exports` declares.
//
// Each subpath builds from a one-line facade under `entries/` that re-exports
// its `src/` module, not from the module itself. The barrel re-exports every
// module as a namespace (`export * as RerankerModel from "./RerankerModel"`),
// and the bundler (rolldown) attaches that namespace object to whichever chunk
// holds the module: were the module an entry, its subpath would export the
// namespace object as an extra internal name (`t`), whatever
// `preserveEntrySignatures` says. Behind a facade the module lands in a shared
// chunk, the subpath file re-exports exactly the module's own exports, and the
// barrel and the subpath share one module instance — the layout the tsup build
// shipped before (#58).
export default packageConfig({
  coverageFloor,
  entry: {
    index: "src/index.ts",
    RerankerModel: "entries/RerankerModel.ts",
    ClassifierModel: "entries/ClassifierModel.ts",
    SpeechModel: "entries/SpeechModel.ts",
    TranscriptionModel: "entries/TranscriptionModel.ts",
    ImageModel: "entries/ImageModel.ts",
    ModerationModel: "entries/ModerationModel.ts",
    VoiceConversionModel: "entries/VoiceConversionModel.ts",
  },
});
