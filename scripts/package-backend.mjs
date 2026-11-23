import { rm, readFile, lstat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve, relative } from "node:path"
import { spawnSync } from "node:child_process"
import { backendSourceFiles } from "../backend/extensions/source-files.mjs"
import { packagedWorkbenchPath } from "../backend/workbench-paths.mjs"
import { packageNodeRuntime } from "./package-node-runtime.mjs"
import { packagingEnvironment } from "./release-settings.mjs"
import {
  verifyRuntimeResources,
  writeRuntimeInventory,
} from "./runtime-packaging.mjs"
import { assembleWorkbench, buildWorkbench } from "./workbench-packaging.mjs"
const root = fileURLToPath(new URL("../", import.meta.url))
const output = resolve(root, "src-tauri/runtime")
const sourceFiles = await backendSourceFiles(resolve(root, "backend"))
buildWorkbench()
if (relative(root, output).replaceAll("\\", "/") !== "src-tauri/runtime")
  throw new Error("Invalid backend output path")
for (const directory of [resolve(root, "src-tauri"), output]) {
  try {
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error(
        "Refusing to deploy through a linked backend output directory"
      )
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}
// 此目录仅包含可重建的正式运行资源，不包含应用数据。
await rm(output, { recursive: true, force: true })
const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@moon/backend",
    "deploy",
    "--prod",
    "--ignore-scripts",
    // Tauri 不展开目录 junction；发行依赖必须完整落为普通目录，开发布局不变。
    "--config.node-linker=hoisted",
    "--registry=https://registry.npmjs.org",
    "src-tauri/runtime",
  ],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: packagingEnvironment(),
  }
)
if (result.status !== 0) process.exit(result.status ?? 1)
// Includes bundled plugin server modules and manifests; web-only sources stay
// in the frontend graphs. Compare actual bytes rather than file fingerprints.
for (const file of sourceFiles) {
  const [source, packaged] = await Promise.all([
    readFile(resolve(root, "backend", file)),
    readFile(resolve(output, file)),
  ])
  if (!source.equals(packaged))
    throw new Error(`Backend deployment omitted or changed ${file}`)
}
await packageNodeRuntime(output)
await assembleWorkbench(resolve(output, packagedWorkbenchPath))
await writeRuntimeInventory(output)
await verifyRuntimeResources(output)
