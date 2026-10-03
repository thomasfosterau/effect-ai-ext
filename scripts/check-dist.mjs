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
 * Every published package that declares a `bin` is also PACKED (`pnpm pack`),
 * unpacked into `node_modules/` of a scratch directory and its bin launched
 * from there (issue #42). Node refuses to type-strip TypeScript under
 * `node_modules`, so a bin that runs `src/*.ts` works from the workspace
 * (whose real path is outside `node_modules`) and fails for every consumer;
 * only a launch from an installed path proves the bin is built JavaScript.
 *
 * Workspace siblings (`@thomasfosterau/*`) resolve to their own `dist` through
 * `dist-resolve-hook.mjs` (installed in-thread with `module.registerHooks()`,
 * #72); everything else resolves as in a consumer's
 * `node_modules`. The expected export names come from the TypeScript checker
 * over each emitted declaration file (value symbols only — types and
 * type-only namespaces have no runtime presence).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { makeDistResolve } from "./dist-resolve-hook.mjs";

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

registerHooks({
  resolve: makeDistResolve(new Map(targets.map((t) => [t.specifier, t.js]))),
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

/**
 * Packs `dir`, unpacks the tarball into `<scratch>/node_modules/<name>` (a real
 * copy, so its real path is under `node_modules`), links its peer and
 * dev-time dependencies in from the workspace, and launches each bin with
 * `--help`.
 */
const checkPackedBin = (dir, manifest) => {
  const scratch = mkdtempSync(path.join(tmpdir(), "check-dist-bin-"));
  try {
    const packed = spawnSync("pnpm", ["pack", "--pack-destination", scratch], {
      cwd: dir,
      encoding: "utf8",
    });
    if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`);
    const tarball = readdirSync(scratch).find((f) => f.endsWith(".tgz"));
    if (tarball === undefined) throw new Error("pnpm pack produced no tarball");

    const installed = path.join(scratch, "node_modules", ...manifest.name.split("/"));
    mkdirSync(installed, { recursive: true });
    const untar = spawnSync(
      "tar",
      ["-xzf", path.join(scratch, tarball), "-C", installed, "--strip-components=1"],
      { encoding: "utf8" },
    );
    if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);

    // The tarball's own dependencies resolve to the workspace's copies, linked
    // beside the package exactly as an install would place them.
    const requested = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}).filter((n) => n === "@effect/platform-node"),
    ];
    for (const name of new Set(requested)) {
      const source = path.join(dir, "node_modules", ...name.split("/"));
      if (!existsSync(source)) continue;
      const link = path.join(scratch, "node_modules", ...name.split("/"));
      mkdirSync(path.dirname(link), { recursive: true });
      symlinkSync(source, link, "dir");
    }

    for (const [bin, rel] of Object.entries(manifest.bin)) {
      const result = spawnSync(process.execPath, [path.join(installed, rel), "--help"], {
        cwd: scratch,
        encoding: "utf8",
      });
      if (result.status !== 0 || result.stderr !== "" || !result.stdout.includes(bin)) {
        throw new Error(
          `bin ${bin} failed from an installed path (exit ${result.status}):\n${result.stderr || result.stdout}`,
        );
      }
      console.log(`ok   ${manifest.name} bin ${bin} (from node_modules)`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

for (const dirName of readdirSync(packagesDir).sort()) {
  const dir = path.join(packagesDir, dirName);
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  if (manifest.private || manifest.bin === undefined) continue;
  try {
    checkPackedBin(dir, manifest);
  } catch (error) {
    failures++;
    console.error(`FAIL ${manifest.name} bin: ${String(error)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} dist entr${failures === 1 ? "y" : "ies"} failed`);
  process.exit(1);
}
