import { access, lstat, readFile, readlink, realpath } from "node:fs/promises"
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"
import { homedir } from "node:os"
import { stripVTControlCharacters } from "node:util"

export const packageName = "@jackwener/opencli"
const registry = "https://registry.npmjs.org"
const exists = (file) =>
  access(file).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false
      throw error
    }
  )
const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

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
  if (!wrapper)
    throw new Error("未找到npm。请先安装可用的Node.js/npm，再重新读取。")
  const actual = await realpath(wrapper)
  const candidates = [
    join(dirname(actual), "node_modules/npm/bin/npm-cli.js"),
    actual,
  ]
  const script = await (async () => {
    for (const candidate of candidates)
      if (candidate.endsWith(".js") && (await exists(candidate)))
        return candidate
    throw new Error("npm入口无法定位，请检查当前Node.js/npm安装。")
  })()
  const localNode = join(
    dirname(actual),
    process.platform === "win32" ? "node.exe" : "node"
  )
  const node = (await exists(localNode))
    ? localNode
    : await executable(process.platform === "win32" ? ["node.exe"] : ["node"])
  if (!node) throw new Error("未找到npm使用的Node.js程序。")
  return { node, script, wrapper }
}

async function compatibilityIssue(packageDirectory) {
  const link = join(homedir(), ".opencli/node_modules/@jackwener/opencli")
  try {
    const info = await lstat(link)
    const target = info.isSymbolicLink()
      ? resolve(dirname(link), await readlink(link))
      : await realpath(link)
    if (!samePath(target, packageDirectory))
      return "全局OpenCLI兼容引用指向另一安装目录。请先恢复到当前官方全局包，再重新读取；尚未调用官方程序。"
    return ""
  } catch (error) {
    if (error.code === "ENOENT") return ""
    return "全局OpenCLI兼容引用无法核对，请检查该引用的访问权限。"
  }
}

function packageEntry(directory, value) {
  if (typeof value !== "string" || isAbsolute(value)) return undefined
  const file = resolve(directory, value)
  const path = relative(directory, file)
  return path === ".." ||
    path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(path)
    ? undefined
    : file
}

// G13：探测结果分类——仅 ENOENT 视为缺失；其他错误输出不可探测及原因码，不与缺失混淆
export async function entryState(directory, file) {
  if (!file) return { state: "missing" }
  try {
    const info = await lstat(file)
    const usable =
      info.isFile() &&
      !info.isSymbolicLink() &&
      samePath(await realpath(directory), directory) &&
      samePath(await realpath(file), file)
    return usable ? { state: "available" } : { state: "missing" }
  } catch (error) {
    if (error.code === "ENOENT") return { state: "missing" }
    return {
      state: "unavailable",
      reason: `${error.code ?? "error"}：${error.message}`,
    }
  }
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

export function softwareService(run) {
  let cached
  let cacheAt = 0
  let reading
  let latestVersion = null
  let latestIssue = ""
  const detect = async (signal, fresh = false) => {
    signal?.throwIfAborted()
    if (!fresh && cached && Date.now() - cacheAt < 3000) return cached
    if (fresh) while (reading) await waitForReading(reading, signal)
    if (!reading) {
      // The plugin owns discovery; callers cancel only their own wait.
      reading = (async () => {
        let value
        try {
          const npm = await npmRuntime()
          const result = await run(
            npm.node,
            [npm.script, "root", "--global", "--json"],
            { timeoutMs: 15000, label: "读取npm全局目录" }
          )
          if (result.code !== 0)
            throw new Error("npm全局目录读取失败，请检查Node.js/npm。")
          let root
          try {
            root = JSON.parse(result.stdout.trim())
          } catch {
            root = result.stdout.trim()
          }
          if (typeof root !== "string" || !isAbsolute(root))
            throw new Error("npm未返回有效的全局安装目录。")
          const directory = resolve(root, packageName)
          let manifest
          try {
            manifest = JSON.parse(
              await readFile(join(directory, "package.json"), "utf8")
            )
          } catch (error) {
            if (error.code !== "ENOENT")
              throw new Error("全局OpenCLI安装元信息无法读取，请修复安装。", {
                cause: error,
              })
          }
          if (manifest && manifest.name !== packageName)
            throw new Error("全局目录中的程序不是官方OpenCLI包。")
          const cli = packageEntry(
            directory,
            typeof manifest?.bin === "string"
              ? manifest.bin
              : manifest?.bin?.opencli
          )
          const entry = await entryState(directory, cli)
          const usable = entry.state === "available"
          const daemon = cli ? join(dirname(cli), "daemon.js") : undefined
          const daemonState = await entryState(directory, daemon)
          value = {
            state: manifest ? "installed" : "not-installed",
            version:
              typeof manifest?.version === "string" ? manifest.version : null,
            path: manifest ? directory : null,
            cliPath: usable ? cli : null,
            daemonPath: daemonState.state === "available" ? daemon : null,
            license:
              typeof manifest?.license === "string" ? manifest.license : null,
            npmPath: npm.wrapper,
            nodePath: npm.node,
            usable,
            issue:
              (await compatibilityIssue(directory)) ||
              (entry.state === "unavailable"
                ? `全局OpenCLI程序入口不可探测（${entry.reason}），请检查安装目录权限。`
                : manifest && !usable
                  ? "全局OpenCLI程序入口缺失或不在实际安装目录，请重新安装官方包。"
                  : ""),
            npm,
            directory,
          }
        } catch (error) {
          if (error.name === "AbortError") throw error
          value = {
            state: "unavailable",
            version: null,
            path: null,
            cliPath: null,
            daemonPath: null,
            license: null,
            npmPath: null,
            nodePath: null,
            usable: false,
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
    invalidate() {
      cacheAt = 0
    },
    summary(info) {
      const { npm: _npm, directory: _directory, ...publicInfo } = info
      return { ...publicInfo, latestVersion, latestIssue }
    },
    async latest(info, signal) {
      if (!info.npm) throw new Error(info.issue || "npm不可用。")
      const result = await run(
        info.npm.node,
        [
          info.npm.script,
          "view",
          packageName,
          "version",
          "--json",
          `--registry=${registry}`,
          "--fetch-timeout=10000",
          "--fetch-retries=0",
        ],
        { signal, timeoutMs: 15000, label: "查询官方版本" }
      )
      if (result.code !== 0) {
        latestIssue = "官方npm版本查询失败：" + npmFailure(result)
        throw new Error(latestIssue)
      }
      let value
      try {
        value = JSON.parse(result.stdout.trim())
      } catch {
        /* Invalid registry response. */
      }
      if (
        typeof value !== "string" ||
        !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value)
      )
        throw new Error("官方npm版本信息无效。")
      latestVersion = value
      latestIssue = ""
      return value
    },
    async mutate(action, info, target, signal) {
      if (!info.npm) throw new Error(info.issue || "npm不可用。")
      if (info.issue && info.issue.includes("兼容引用"))
        throw new Error(info.issue)
      const args =
        action === "uninstall"
          ? ["uninstall", "--global", packageName]
          : [
              "install",
              "--global",
              `${packageName}@${target}`,
              `--registry=${registry}`,
            ]
      const result = await run(info.npm.node, [info.npm.script, ...args], {
        signal,
        timeoutMs: 180000,
        label: action === "uninstall" ? "卸载官方OpenCLI" : "安装官方OpenCLI",
      })
      cacheAt = 0
      if (result.code !== 0)
        throw new Error("npm管理命令未成功结束：" + npmFailure(result))
      return detect(undefined, true)
    },
  }
}
