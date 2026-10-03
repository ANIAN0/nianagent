import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import test from "node:test"
import {
  assertCompatibleOutput,
  createBuildGraphs,
  loadMoonViteConfig,
  mergeGraphManifests,
  outputPath,
  parseBuildArguments,
} from "../build-frontend.mjs"

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "moon-build-output-"))
  t.after(() => {
    const path = resolve(directory)
    assert.ok(path.startsWith(resolve(tmpdir()) + sep))
    assert.ok(path.split(sep).at(-1).startsWith("moon-build-output-"))
    rmSync(path, { recursive: true, force: true })
  })
  return directory
}

test("the official build has an independent App graph and one graph for all three catalog URLs", async () => {
  const [app, catalogs] = await createBuildGraphs()
  assert.deepEqual(Object.keys(app.config.build.rolldownOptions.input), ["app"])
  assert.deepEqual(Object.keys(catalogs.config.build.rolldownOptions.input), [
    "apiCatalog",
    "catalog",
    "preview",
  ])
  assert.match(app.config.build.rolldownOptions.input.app, /[\\/]index\.html$/)
  const entries = Object.values(
    catalogs.config.build.rolldownOptions.input
  ).map((entry) => entry.replaceAll("\\", "/"))
  assert.ok(entries.some((entry) => entry.endsWith("/api-catalog/index.html")))
  assert.ok(entries.some((entry) => entry.endsWith("/ui-catalog/index.html")))
  assert.ok(entries.some((entry) => entry.endsWith("/ui-catalog/preview.html")))
  assert.equal(app.config.configFile, false)
  assert.equal(catalogs.config.configFile, false)
  assert.equal(app.config.build.outDir, catalogs.config.build.outDir)
  assert.equal(app.config.build.emptyOutDir, true)
  assert.equal(catalogs.config.build.emptyOutDir, false)
  assert.equal(app.config.build.copyPublicDir, true)
  assert.equal(catalogs.config.build.copyPublicDir, false)
  assert.notEqual(app.config.build.assetsDir, catalogs.config.build.assetsDir)
  assert.notEqual(app.config.build.manifest, catalogs.config.build.manifest)
  assert.notEqual(app.config.plugins[0], catalogs.config.plugins[0])
  assert.equal(app.config.build.rolldownOptions.output, undefined)
  assert.equal(catalogs.config.build.rolldownOptions.output, undefined)
  const previewConfig = await loadMoonViteConfig({
    command: "serve",
    isPreview: true,
  })
  assert.ok(
    previewConfig.plugins
      .flat(Infinity)
      .some((plugin) => typeof plugin.configurePreviewServer === "function")
  )
})

test("merged manifests preserve URL entries and rewrite both static and dynamic collisions within each graph", () => {
  const app = {
    "index.html": {
      file: "assets/app/main.js",
      isEntry: true,
      imports: ["_runtime.js"],
      dynamicImports: ["src/later.ts"],
    },
    "_runtime.js": { file: "assets/app/runtime.js" },
    "src/later.ts": {
      file: "assets/app/later.js",
      isDynamicEntry: true,
      imports: ["_runtime.js"],
    },
  }
  const catalogs = {
    "ui-catalog/index.html": {
      file: "assets/catalogs/catalog.js",
      isEntry: true,
      imports: ["_runtime.js"],
      dynamicImports: ["src/later.ts"],
    },
    "_runtime.js": { file: "assets/catalogs/runtime.js" },
    "src/later.ts": {
      file: "assets/catalogs/later.js",
      isDynamicEntry: true,
      imports: ["_runtime.js"],
    },
  }
  const merged = mergeGraphManifests({ app, catalogs })
  assert.deepEqual(merged["index.html"].imports, ["app:_runtime.js"])
  assert.deepEqual(merged["index.html"].dynamicImports, ["app:src/later.ts"])
  assert.deepEqual(merged["ui-catalog/index.html"].imports, [
    "catalogs:_runtime.js",
  ])
  assert.deepEqual(merged["catalogs:src/later.ts"].imports, [
    "catalogs:_runtime.js",
  ])
  assert.equal(merged["app:_runtime.js"].file, app["_runtime.js"].file)
  assert.equal(
    merged["catalogs:_runtime.js"].file,
    catalogs["_runtime.js"].file
  )
  for (const entry of Object.values(merged))
    for (const key of [
      ...(entry.imports ?? []),
      ...(entry.dynamicImports ?? []),
    ])
      assert.ok(Object.hasOwn(merged, key))
  assert.deepEqual(
    app["index.html"].imports,
    ["_runtime.js"],
    "the original graph manifest stays standard"
  )
  assert.throws(
    () => mergeGraphManifests({ app: { main: { imports: ["missing"] } } }),
    /references missing missing/
  )
})

test("the second graph cannot overwrite different existing output, including binary assets", (t) => {
  const directory = temporaryDirectory(t)
  writeFileSync(join(directory, "shared.js"), "App content")
  assert.doesNotThrow(() =>
    assertCompatibleOutput(directory, "shared.js", "App content")
  )
  assert.throws(
    () => assertCompatibleOutput(directory, "shared.js", "Catalog content"),
    /overwrite different App output/
  )
  assert.equal(
    readFileSync(join(directory, "shared.js"), "utf8"),
    "App content"
  )
  writeFileSync(join(directory, "binary.bin"), Buffer.from([0, 255, 9]))
  assert.doesNotThrow(() =>
    assertCompatibleOutput(directory, "binary.bin", new Uint8Array([0, 255, 9]))
  )
  assert.throws(
    () =>
      assertCompatibleOutput(directory, "binary.bin", Buffer.from([0, 255, 8])),
    /overwrite different App output/
  )
  assert.throws(() => outputPath(directory, "../outside.js"), /escapes dist/)
})

test("the existing manifest command and explicit mode/base remain compatible and errors are not swallowed", () => {
  assert.equal(parseBuildArguments([]).manifest, ".vite/manifest.json")
  assert.equal(
    parseBuildArguments(["--manifest"]).manifest,
    ".vite/manifest.json"
  )
  assert.equal(
    parseBuildArguments(["--manifest", "metadata.json"]).manifest,
    "metadata.json"
  )
  assert.deepEqual(
    parseBuildArguments(["--manifest", "--mode", "staging", "--base=/moon/"]),
    { manifest: ".vite/manifest.json", mode: "staging", base: "/moon/" }
  )
  assert.throws(
    () => parseBuildArguments(["--unknown"]),
    /Unsupported frontend build option/
  )
  assert.throws(() => parseBuildArguments(["--mode"]), /requires a value/)
  assert.throws(
    () => parseBuildArguments(["--manifest=.vite/app-manifest.json"]),
    /cannot replace a graph manifest/
  )
})
