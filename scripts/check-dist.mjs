/**
 * Dist-level import check (issue #32): run after `pnpm run build`.
 *
 * For every published package and every subpath its `publishConfig.exports`
 * declares, imports the BUILT `dist/*.js` under real Node ESM (never the
 * `src` the vitest suites resolve) and asserts that every value export its
 * bundled `.d.ts` promises exists at runtime. This is the check that catches
 * a bundler folding an `export *` into an internal object — the gateway's
 * `RerankerModel` re-export shipped that way in 0.1.x, so
 * `import { make } from "@thomasfosterau/effect-ai-gateway"` threw a
 * `SyntaxError` under Node while every src-level test passed.
 *
 * Workspace siblings (`@thomasfosterau/*`) resolve to their own `dist` through
 * `dist-resolve-hook.mjs`; everything else resolves as in a consumer's
 * `node_modules`. The expected export names come from the TypeScript checker
 * over each emitted declaration file (value symbols only — types and
 * type-only namespaces have no runtime presence).
 */
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(root, "packages");

/** Every published package's built subpath entries. */
const targets = [];
for (const dir of readdirSync(packagesDir).sort()) {
  const manifest = JSON.parse(readFileSync(path.join(packagesDir, dir, "package.json"), "utf8"));
  if (manifest.private) continue;
  for (const [subpath, conditions] of Object.entries(manifest.publishConfig.exports)) {
    const specifier = subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
    targets.push({
      specifier,
      js: path.join(packagesDir, dir, conditions.import),
      dts: path.join(packagesDir, dir, conditions.types),
    });
  }
}

register(new URL("./dist-resolve-hook.mjs", import.meta.url), {
  data: { entries: targets.map((t) => [t.specifier, t.js]) },
});

/** Value export names the declaration file promises, via the TS checker. */
const expectedValueExports = (dts) => {
  const program = ts.createProgram([dts], {
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(dts);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`no module symbol for ${dts}`);
  return checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return (target.flags & ts.SymbolFlags.Value) !== 0;
    })
    .map((symbol) => symbol.getName())
    .sort();
};

let failures = 0;
for (const { specifier, dts } of targets) {
  const expected = expectedValueExports(dts);
  try {
    const runtime = new Set(Object.keys(await import(specifier)));
    const missing = expected.filter((name) => !runtime.has(name));
    if (missing.length > 0) {
      failures++;
      console.error(`FAIL ${specifier}: declared but missing at runtime: ${missing.join(", ")}`);
    } else {
      console.log(`ok   ${specifier} (${expected.length} value exports)`);
    }
  } catch (error) {
    failures++;
    console.error(`FAIL ${specifier}: ${String(error)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} dist entr${failures === 1 ? "y" : "ies"} failed`);
  process.exit(1);
}
