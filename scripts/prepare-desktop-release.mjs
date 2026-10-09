import { mkdir, lstat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  projectRoot,
  updaterPublicKey,
  windowsTarget,
} from "./release-settings.mjs"

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error(`首期发行需要 Windows x64 构建机，目标 ${windowsTarget}`)
const pubkey = updaterPublicKey()
const directory = resolve(projectRoot, ".dev/release")
for (const path of [resolve(projectRoot, ".dev"), directory]) {
  await mkdir(path, { recursive: true })
  if ((await lstat(path)).isSymbolicLink())
    throw new Error("拒绝通过链接目录写入发行配置")
}
// 公钥不是秘密，但构建配置不写回源码；编译环境与插件配置使用同一个值。
await writeFile(
  resolve(directory, "updater-config.json"),
  `${JSON.stringify({ plugins: { updater: { pubkey } } }, null, 2)}\n`
)
console.info("发行公钥配置已准备，尚未构建或发布")
