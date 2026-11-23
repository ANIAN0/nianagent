import {
  access,
  constants,
  lstat,
  open,
  readFile,
  realpath,
} from "node:fs/promises"
import { delimiter, dirname, join, isAbsolute, resolve } from "node:path"
import { stripVTControlCharacters } from "node:util"

export const packageName = "agent-desktop"
const registry = "https://registry.npmjs.org"

const exists = (file) =>
  access(file).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false
      throw error
    }
  )

const samePath = (a, b) =>
  process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b)

function npmFailure(result) {
  const detail = stripVTControlCharacters(
    result.stderr?.trim() || result.stdout?.trim() || ""
  )
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-8)
    .join("\n")
    .slice(-1400)
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[隐藏]@")
    .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [隐藏]")
    .replace(
      /((?:Proxy-)?Authorization\s*[:=]\s*)(?:Basic|Bearer)\s+[^\s"'<>]+/gi,
      "$1[隐藏]"
    )
    .replace(
      /(["']?(?:access[_-]?token|token|password|secret|api[_-]?key|_auth(?:Token)?)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"'&,;]+)/gi,
      "$1[隐藏]"
    )
  return `${detail || "npm未提供可读错误"}（退出码${result.code}）。请重新读取实际安装状态，再决定重试。`
}

async function executable(names) {
  for (const directory of (process.env.PATH || process.env.Path || "").split(
    delimiter
  )) {
    if (!directory) continue
    for (const name of names) {
      const file = join(directory.replace(/^"|"$/g, ""), name)
      if (await exists(file)) return resolve(file)
    }
  }
}

async function npmRuntime() {
  const wrapper = await executable(
    process.platform === "win32" ? ["npm.cmd", "npm.ps1"] : ["npm"]
  )
  if (!wrapper) return null
  const actual = await realpath(wrapper)
  const candidates = [
    join(dirname(actual), "node_modules/npm/bin/npm-cli.js"),
    actual,
  ]
  const script = await (async () => {
    for (const candidate of candidates) {
      if (candidate.endsWith(".js") && (await exists(candidate)))
        return candidate
    }
    return null
  })()
  if (!script) return null
  const localNode = join(
    dirname(actual),
    process.platform === "win32" ? "node.exe" : "node"
  )
  const node = (await exists(localNode))
    ? localNode
    : await executable(process.platform === "win32" ? ["node.exe"] : ["node"])
  if (!node) return null
  return { node, script, wrapper }
}

async function packageBinary(directory, candidates) {
  for (const name of candidates) {
    const file = join(directory, "bin", name)
    try {
      const info = await lstat(file)
      if (!info.isFile() || !samePath(await realpath(file), file)) continue
      await access(
        file,
        process.platform === "win32" ? constants.F_OK : constants.X_OK
      )
      if (process.platform !== "win32") {
        const handle = await open(file)
        try {
          const magic = Buffer.alloc(2)
          await handle.read(magic)
          if (magic.toString() === "#!") continue
        } finally {
          await handle.close()
        }
      }
      return file
    } catch (error) {
      if (!["ENOENT", "EACCES", "EPERM"].includes(error.code)) throw error
    }
  }
}

async function cliVersion(run, cli, signal) {
  const result = await run(cli, ["version"], {
    signal,
    timeoutMs: 8000,
    label: "检测 agent-desktop 版本",
  })
  try {
    const payload = JSON.parse(result.stdout)
    if (
      result.code === 0 &&
      payload?.ok &&
      typeof payload.data?.version === "string"
    )
      return payload.data.version
  } catch {
    // The upstream CLI returns a JSON envelope.
  }
  return null
}

function waitForReading(promise, signal) {
  signal?.throwIfAborted()
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      }
    )
  })
}

async function detectNativePathCli(run, npm, signal) {
  const names =
    process.platform === "win32" ? ["agent-desktop.exe"] : ["agent-desktop"]
  const cli = await executable(names)
  if (!cli) return null
  const version = await cliVersion(run, cli, signal).catch(() => {
    signal?.throwIfAborted()
    return null
  })
  return {
    state: "installed",
    source: "path",
    version,
    path: dirname(cli),
    cliPath: cli,
    license: "Apache-2.0",
    npmPath: npm?.wrapper ?? null,
    nodePath: npm?.node ?? null,
    usable: Boolean(version),
    launcherFallback: false,
    issue: version
      ? ""
      : "PATH 中的 agent-desktop 无法执行或返回无效版本信息。",
    npm,
  }
}

export function softwareService(run) {
  let cached
  let cacheAt = 0
  let reading
  let latestVersion = null
  let latestIssue = ""
  let latestCheck
  let latestCheckedAt = 0

  const detect = async (signal, fresh = false) => {
    signal?.throwIfAborted()
    if (!fresh && cached && Date.now() - cacheAt < 3000) return cached
    if (fresh) while (reading) await waitForReading(reading, signal)
    if (!reading) {
      reading = (async () => {
        let value
        try {
          const npm = await npmRuntime()
          let npmIssue = ""
          if (npm) {
            const result = await run(
              npm.node,
              [npm.script, "root", "--global", "--json"],
              { timeoutMs: 15000, label: "读取npm全局目录" }
            )
            if (result.code !== 0)
              npmIssue = "无法确认全局 npm 安装目录：" + npmFailure(result)
            if (result.code === 0) {
              let root
              try {
                root = JSON.parse(result.stdout.trim())
              } catch {
                root = result.stdout.trim()
              }
              if (typeof root === "string" && isAbsolute(root)) {
                const directory = resolve(root, packageName)
                let manifest
                try {
                  manifest = JSON.parse(
                    await readFile(join(directory, "package.json"), "utf8")
                  )
                } catch (error) {
                  if (error.code !== "ENOENT")
                    throw new Error("全局 agent-desktop 元信息无法读取。", {
                      cause: error,
                    })
                }
                if (manifest && manifest.name === packageName) {
                  const key = `${process.platform}-${process.arch}`
                  const windows = process.platform === "win32"
                  const plain = await packageBinary(directory, [
                    windows ? "agent-desktop.exe" : "agent-desktop",
                  ])
                  const bundled =
                    windows || !plain
                      ? await packageBinary(directory, [
                          `agent-desktop-${key}${windows ? ".exe" : ""}`,
                        ])
                      : null
                  // On Unix the extensionless plain entry may be the Node launcher.
                  const cliPath = plain || bundled
                  const helperName = {
                    darwin: "agent-desktop-macos-helper",
                    linux: "agent-desktop-linux-clipboard-owner",
                  }[process.platform]
                  const helper = helperName
                    ? await packageBinary(directory, [
                        helperName,
                        `${helperName}-${key}`,
                      ])
                    : null
                  const expectedVersion =
                    typeof manifest.version === "string"
                      ? manifest.version
                      : null
                  const version =
                    cliPath && (!helperName || helper)
                      ? await cliVersion(run, cliPath).catch(() => null)
                      : null
                  const usable = Boolean(version && version === expectedVersion)
                  value = {
                    state: "installed",
                    source: "npm",
                    version: version || expectedVersion,
                    path: directory,
                    cliPath: cliPath || null,
                    license:
                      typeof manifest.license === "string"
                        ? manifest.license
                        : "Apache-2.0",
                    npmPath: npm.wrapper,
                    nodePath: npm.node,
                    usable,
                    launcherFallback: Boolean(bundled && !plain),
                    issue: usable
                      ? ""
                      : !cliPath
                        ? "全局 agent-desktop 原生程序缺失，请重新安装。"
                        : helperName && !helper
                          ? "全局 agent-desktop 的平台辅助程序缺失，请重新安装。"
                          : "全局 agent-desktop 无法执行或与 npm 包版本不一致。",
                    npm,
                  }
                  return value
                }
              } else npmIssue = "npm 未返回有效的全局安装目录。"
            }
          }

          const pathCli = await detectNativePathCli(run, npm)
          if (pathCli) return pathCli

          if (!npm || npmIssue) {
            return {
              state: "unavailable",
              source: null,
              version: null,
              path: null,
              cliPath: null,
              license: null,
              npmPath: null,
              nodePath: null,
              usable: false,
              launcherFallback: false,
              issue:
                npmIssue ||
                "未找到 npm 或 PATH 中的 agent-desktop；请先安装 Node.js/npm 或将原生二进制放入 PATH。",
            }
          }

          value = {
            state: "not-installed",
            source: null,
            version: null,
            path: null,
            cliPath: null,
            license: null,
            npmPath: npm.wrapper,
            nodePath: npm.node,
            usable: false,
            launcherFallback: false,
            issue: "",
            npm,
          }
        } catch (error) {
          if (error.name === "AbortError") throw error
          value = {
            state: "unavailable",
            source: null,
            version: null,
            path: null,
            cliPath: null,
            license: null,
            npmPath: null,
            nodePath: null,
            usable: false,
            launcherFallback: false,
            issue: error.message,
          }
        }
        return value
      })().finally(() => {
        reading = undefined
      })
      void reading.catch(() => {})
    }
    const value = await waitForReading(reading, signal)
    signal?.throwIfAborted()
    cached = value
    cacheAt = Date.now()
    return value
  }

  return {
    detect,
    summary(info) {
      const { npm: _npm, ...publicInfo } = info
      return { ...publicInfo, latestVersion, latestIssue }
    },
    async latest(info, signal, fresh = false) {
      if (!info.npm) throw new Error(info.issue || "npm 不可用。")
      if (!fresh && !latestCheck && Date.now() - latestCheckedAt < 60_000) {
        if (latestIssue) throw new Error(latestIssue)
        return latestVersion
      }
      if (!latestCheck) {
        latestCheck = queryLatest(info.npm)
          .then(
            (version) => {
              latestVersion = version
              latestIssue = ""
              return version
            },
            (error) => {
              latestIssue = error.message
              throw error
            }
          )
          .finally(() => {
            latestCheckedAt = Date.now()
            latestCheck = undefined
          })
      }
      return waitForReading(latestCheck, signal)
    },
    async mutate(action, info, target, signal) {
      if (!info.npm) throw new Error(info.issue || "npm 不可用。")
      const args =
        action === "uninstall"
          ? ["uninstall", "--global", packageName]
          : [
              "install",
              "--global",
              `${packageName}@${target}`,
              `--allow-scripts=${packageName}`,
              `--registry=${registry}`,
            ]
      try {
        const result = await run(info.npm.node, [info.npm.script, ...args], {
          signal,
          timeoutMs: 180000,
          label:
            action === "uninstall"
              ? "卸载 agent-desktop"
              : "安装 agent-desktop",
        })
        if (result.code !== 0)
          throw new Error("npm 管理命令未成功结束：" + npmFailure(result))
        return await detect(undefined, true)
      } finally {
        cacheAt = 0
      }
    },
  }

  async function queryLatest(npm) {
    const result = await run(
      npm.node,
      [
        npm.script,
        "view",
        packageName,
        "version",
        "--json",
        `--registry=${registry}`,
        "--fetch-timeout=10000",
        "--fetch-retries=0",
      ],
      { timeoutMs: 15000, label: "查询官方版本" }
    )
    if (result.code !== 0) {
      throw new Error("官方 npm 版本查询失败：" + npmFailure(result))
    }
    let value
    try {
      value = JSON.parse(result.stdout.trim())
    } catch {
      /* ignore */
    }
    if (
      typeof value !== "string" ||
      !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value)
    )
      throw new Error("官方 npm 版本信息无效。")
    return value
  }
}
