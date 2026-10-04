import { rm, readFile, lstat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve, relative } from "node:path"
import { spawnSync } from "node:child_process"
import { backendSourceFiles } from "../backend/extensions/source-files.mjs"
const root = fileURLToPath(new URL("../", import.meta.url))
const output = resolve(root, "src-tauri/runtime")
const sourceFiles = await backendSourceFiles(resolve(root, "backend"))
if (relative(root, output).replaceAll("\\", "/") !== "src-tauri/runtime")
  throw new Error("Invalid backend output path")
for (const directory of [resolve(root, "src-tauri"), output]) {
  try {
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error("Refusing to deploy through a linked backend output directory")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}
// This directory contains only the reproducible pnpm deploy output.
await rm(output, { recursive: true, force: true })
const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@moon/backend",
    "deploy",
    "--prod",
    "--ignore-scripts",
    "--registry=https://registry.npmjs.org",
    "src-tauri/runtime",
  ],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" }
)
if (result.status !== 0) process.exit(result.status ?? 1)
for (const file of sourceFiles) {
  const [source, packaged] = await Promise.all([readFile(resolve(root, "backend", file)), readFile(resolve(output, file))])
  if (!source.equals(packaged)) throw new Error(`Backend deployment omitted or changed ${file}`)
}
