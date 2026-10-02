import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve, relative } from "node:path"
import { spawnSync } from "node:child_process"
const root = fileURLToPath(new URL("../", import.meta.url))
const output = resolve(root, "src-tauri/runtime")
if (relative(root, output).replaceAll("\\", "/") !== "src-tauri/runtime")
  throw new Error("Invalid backend output path")
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
process.exit(result.status ?? 1)
