// Fixture for tests/cli/loader.test.ts: resolves `./b` (next to both `b.js`
// and `b.ts`) through `require()`, `createRequire()` and ESM `import()`. The
// loader must leave the two CommonJS resolutions to Node (`b.js`) and apply
// its `.ts`-first probing only to the ESM one (`b.ts`) (#79).
const { createRequire } = require("node:module");

const viaRequire = require("./b").which;
const viaCreateRequire = createRequire(__filename)("./b").which;

import("./b").then((m) => {
  console.log(`${viaRequire} ${viaCreateRequire} ${m.which}`);
});
