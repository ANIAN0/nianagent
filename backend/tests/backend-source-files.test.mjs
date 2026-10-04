import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, basename, resolve, sep } from "node:path"
import { backendSourceFiles } from "../extensions/source-files.mjs"

test("host fingerprint and distribution scope include recursive formal extension code and exclude runtime/test files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moon-source-scope-"))
  t.after(async () => { assert.equal(basename(root).startsWith("moon-source-scope-"), true); assert.equal(resolve(root).startsWith(resolve(tmpdir()) + sep), true); await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, "extensions", "modules", "fixture"), { recursive: true })
  await mkdir(join(root, "tests"))
  await writeFile(join(root, "rpc.mjs"), "export const rpc = true")
  await writeFile(join(root, "extensions", "helper.mjs"), "export const helper = true")
  await writeFile(join(root, "extensions", "modules", "fixture", "manifest.mjs"), "export default {}")
  await writeFile(join(root, "extensions", "modules", "fixture", "README.md"), "Module documentation")
  await writeFile(join(root, "tests", "test.mjs"), "Not formal host source")
  await writeFile(join(root, "runtime.json"), "{}")
  assert.deepEqual(await backendSourceFiles(root), ["extensions/helper.mjs", "extensions/modules/fixture/manifest.mjs", "rpc.mjs"])
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(pkg.files.includes("extensions/**/*.mjs"), true)
  await writeFile(join(root, "extensions", "modules", "fixture", "runtime.json"), "{}")
  await assert.rejects(backendSourceFiles(root), /仅支持/)
})

test("source discovery rejects a linked extension tree rather than publishing or hashing outside files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moon-source-links-"))
  t.after(async () => { assert.equal(basename(root).startsWith("moon-source-links-"), true); assert.equal(resolve(root).startsWith(resolve(tmpdir()) + sep), true); await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, "outside"))
  await mkdir(join(root, "backend"))
  await writeFile(join(root, "outside", "manifest.mjs"), "export default {}")
  await symlink(join(root, "outside"), join(root, "backend", "extensions"), process.platform === "win32" ? "junction" : "dir")
  await assert.rejects(backendSourceFiles(join(root, "backend")), /符号链接/)
})
