import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { readWorkbenchSettings } from "../../backend/workbench-settings.mjs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const base = resolve(
  process.env.MOON_REPO_ROOT || resolve(import.meta.dirname, "../.."),
  ".dev",
  "moon"
)
let dataRoot = process.env.MOON_DATA_DIR
if (!dataRoot) {
  try {
    const bootstrap = JSON.parse(
      await readFile(join(base, "bootstrap.json"), "utf8")
    )
    dataRoot = resolve(base, bootstrap.dataRoot)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    dataRoot = join(base, "data")
  }
}
process.env.MOON_DATA_DIR = resolve(dataRoot)
const port = String(
  process.env.PORT ||
    process.env.MOON_WORKBENCH_PORT ||
    process.env.MOON_NOTES_PORT ||
    (await readWorkbenchSettings(join(dataRoot, "plugins"))).port
)
process.env.MOON_WORKBENCH_PORT = port
const next = require.resolve("next/dist/bin/next")
process.argv = [
  process.execPath,
  next,
  "dev",
  "--hostname",
  "127.0.0.1",
  "--port",
  port,
  ...args,
]
require(next)
