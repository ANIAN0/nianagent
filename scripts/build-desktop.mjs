import { spawnSync } from "node:child_process"
import { projectRoot, windowsTarget } from "./release-settings.mjs"
import "./prepare-desktop-release.mjs"

if (!process.env.TAURI_SIGNING_PRIVATE_KEY)
  throw new Error(
    "正式构建需要 TAURI_SIGNING_PRIVATE_KEY；私钥只从构建环境提供"
  )
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "tauri",
    "build",
    "--config",
    "src-tauri/tauri.production.conf.json",
    "--config",
    ".dev/release/updater-config.json",
    "--target",
    windowsTarget,
    "--bundles",
    "nsis",
  ],
  { cwd: projectRoot, stdio: "inherit", shell: process.platform === "win32" }
)
process.exit(result.status ?? 1)
