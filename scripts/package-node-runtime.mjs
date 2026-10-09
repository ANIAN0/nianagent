import { copyFile, lstat, mkdir, rename, rm, stat } from "node:fs/promises"
import { createWriteStream } from "node:fs"
import { resolve, relative } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { spawnSync } from "node:child_process"
import {
  nodeVersion,
  packagingEnvironment,
  projectRoot,
} from "./release-settings.mjs"

export async function packageNodeRuntime(output) {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error(
      "首期后端发行包只能在 Windows x64 制备，避免原生依赖架构混用"
    )
  const cache = resolve(projectRoot, ".dev/packaging")
  const name = `node-v${nodeVersion}-win-x64`
  const archive = resolve(cache, `${name}.zip`)
  const partial = `${archive}.partial`
  const extract = resolve(cache, `node-extract-${process.pid}`)
  for (const directory of [resolve(projectRoot, ".dev"), cache]) {
    await mkdir(directory, { recursive: true })
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error("拒绝通过链接目录制备 Node 运行时")
  }
  // 只删除本脚本当前进程产生的展开目录；不递归清理用户数据或整个缓存。
  async function cleanExtract() {
    if (relative(cache, extract) !== `node-extract-${process.pid}`)
      throw new Error("Node 展开目录超出约定范围")
    try {
      if ((await lstat(extract)).isSymbolicLink())
        throw new Error("拒绝清理链接的 Node 展开目录")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    await rm(extract, { recursive: true, force: true })
  }
  try {
    const cached = await lstat(archive).catch((error) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (cached && !cached.isFile()) throw new Error("Node 缓存不是普通文件")
    if (!cached) {
      const response = await fetch(
        `https://nodejs.org/dist/v${nodeVersion}/${name}.zip`,
        { signal: AbortSignal.timeout(120_000) }
      )
      if (!response.ok || !response.body)
        throw new Error(`Node 官方运行时下载失败（HTTP ${response.status}）`)
      if ((await lstat(partial).catch(() => null))?.isSymbolicLink())
        throw new Error("拒绝写入链接的 Node 下载文件")
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(partial)
      )
      const expected = Number(response.headers.get("content-length"))
      if (expected > 0 && (await stat(partial)).size !== expected)
        throw new Error("Node 运行时下载未完成，请删除本次 partial 文件后重试")
      await rename(partial, archive)
    }
    await cleanExtract()
    const expansion = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Expand-Archive -LiteralPath $env:MOON_NODE_ARCHIVE -DestinationPath $env:MOON_NODE_EXTRACT -Force",
      ],
      {
        stdio: "inherit",
        env: {
          ...packagingEnvironment(),
          MOON_NODE_ARCHIVE: archive,
          MOON_NODE_EXTRACT: extract,
        },
      }
    )
    if (expansion.status !== 0) throw new Error("Node 官方运行时展开失败")
    for (const file of ["node.exe", "LICENSE"]) {
      const source = resolve(extract, name, file)
      if (!(await lstat(source)).isFile())
        throw new Error(`Node 发行包缺少 ${file}`)
      await copyFile(
        source,
        resolve(output, file === "LICENSE" ? "NODE-LICENSE.txt" : file)
      )
    }
    const executable = resolve(output, "node.exe")
    const result = spawnSync(
      executable,
      [
        "-e",
        "process.stdout.write(JSON.stringify({version:process.versions.node,platform:process.platform,architecture:process.arch}))",
      ],
      { encoding: "utf8", timeout: 15_000, env: packagingEnvironment() }
    )
    if (result.status !== 0) throw new Error("包内 Node 无法运行")
    const actual = JSON.parse(result.stdout)
    if (
      actual.version !== nodeVersion ||
      actual.platform !== "win32" ||
      actual.architecture !== "x64"
    )
      throw new Error("包内 Node 版本或目标架构不符")
    const temporary = resolve(cache, "runtime-smoke")
    await mkdir(temporary, { recursive: true })
    const imports = spawnSync(
      executable,
      [
        "--input-type=module",
        "-e",
        "await import('@earendil-works/pi-coding-agent'); await import('@earendil-works/pi-mcp'); console.info('包内后端依赖加载通过')",
      ],
      {
        cwd: output,
        stdio: "inherit",
        timeout: 30_000,
        env: {
          ...packagingEnvironment(),
          PI_CODING_AGENT_DIR: resolve(temporary, "agent"),
          TEMP: temporary,
          TMP: temporary,
        },
      }
    )
    if (imports.status !== 0) throw new Error("包内 Node 无法加载正式后端依赖")
    console.info(
      `已打包并运行 Node ${nodeVersion} / Windows x64（含第三方许可）`
    )
  } finally {
    await cleanExtract()
  }
}
