import { access, lstat, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { SCRCPY_CONTROL_VERSION } from "./scrcpy-control.mjs"

const exists = (file) =>
  access(file).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false
      throw error
    }
  )

const isFile = async (file) => {
  try {
    return (await stat(file)).isFile()
  } catch (error) {
    if (process.platform === "win32" && error?.code === "EACCES") {
      try {
        const info = await lstat(file)
        if (!info.isDirectory() && (info.isFile() || info.isSymbolicLink())) {
          await access(file)
          return true
        }
      } catch {
        return false
      }
    }
    return false
  }
}

const isDir = async (dir) => {
  try {
    return (await stat(dir)).isDirectory()
  } catch {
    return false
  }
}

const scrcpyNames =
  process.platform === "win32" ? ["scrcpy.exe", "scrcpy.cmd"] : ["scrcpy"]
const adbNames =
  process.platform === "win32" ? ["adb.exe", "adb.cmd"] : ["adb"]

async function extraSearchDirs() {
  const dirs = []
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || join(homedir(), "AppData/Local")
    const programData = process.env.ProgramData || "C:\\ProgramData"
    dirs.push(
      join(homedir(), "scoop/shims"),
      join(homedir(), "scoop/apps/scrcpy/current"),
      join(localAppData, "Microsoft/WinGet/Links"),
      join(localAppData, "Microsoft/WindowsApps"),
      join(programData, "chocolatey/bin")
    )
    const packagesDir = join(localAppData, "Microsoft/WinGet/Packages")
    try {
      const entries = (await readdir(packagesDir))
        .filter((entry) => entry.startsWith("Genymobile.scrcpy"))
        .sort()
        .reverse()
      for (const entry of entries) {
        const pkgDir = join(packagesDir, entry)
        const children = (await readdir(pkgDir).catch(() => []))
          .sort()
          .reverse()
        for (const child of children) {
          const sub = join(pkgDir, child)
          if (await isDir(sub)) dirs.push(sub)
        }
        dirs.push(pkgDir)
      }
    } catch {
      /* ignore */
    }
    const chocoTools = join(programData, "chocolatey/lib/scrcpy/tools")
    try {
      const entries = (await readdir(chocoTools)).sort().reverse()
      for (const entry of entries) {
        const sub = join(chocoTools, entry)
        if (await isDir(sub)) dirs.push(sub)
      }
      dirs.push(chocoTools)
    } catch {
      /* ignore */
    }
  } else if (process.platform === "darwin") {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin")
  } else {
    dirs.push("/usr/local/bin", "/usr/bin")
  }
  return dirs
}

async function findInDirs(dirs, names) {
  for (const rawDir of dirs) {
    if (!rawDir) continue
    const dir = rawDir.replace(/^"|"$/g, "")
    for (const name of names) {
      const candidate = join(dir, name)
      if (await isFile(candidate)) return resolve(candidate)
    }
  }
  return null
}

async function findExecutable(names, customDir = null) {
  if (customDir) {
    const hit = await findInDirs([customDir], names)
    if (hit) return { path: hit, source: "custom" }
  }
  const pathDirs = (process.env.PATH || process.env.Path || "").split(delimiter)
  const inPath = await findInDirs(pathDirs, names)
  if (inPath) return { path: inPath, source: "path" }
  const inExtra = await findInDirs(await extraSearchDirs(), names)
  if (inExtra) return { path: inExtra, source: "package-manager" }
  return null
}

async function resolveCustomInput(customPath) {
  const trimmed = String(customPath || "").trim()
  if (!trimmed) return { valid: true, dir: null, issue: "" }
  const resolved = resolve(trimmed)
  if (!(await exists(resolved))) {
    return {
      valid: false,
      dir: null,
      issue: `自定义路径不存在：${resolved}`,
    }
  }
  if (await isDir(resolved)) {
    return { valid: true, dir: resolved, issue: "" }
  }
  const info = await lstat(resolved).catch(() => null)
  if (info?.isFile()) {
    return { valid: true, dir: dirname(resolved), issue: "" }
  }
  return {
    valid: false,
    dir: null,
    issue: `自定义路径不可用：${resolved}`,
  }
}

async function findScrcpyServer(scrcpyExePath, customDir) {
  const candidates = []
  if (process.env.SCRCPY_SERVER_PATH) {
    candidates.push(process.env.SCRCPY_SERVER_PATH)
  }
  if (customDir) {
    candidates.push(join(customDir, "scrcpy-server"))
    candidates.push(join(customDir, "scrcpy-server.jar"))
  }
  if (scrcpyExePath) {
    const dir = dirname(scrcpyExePath)
    candidates.push(
      join(dir, "scrcpy-server"),
      join(dir, "scrcpy-server.jar"),
      resolve(dir, "../share/scrcpy/scrcpy-server")
    )
  }
  if (process.platform !== "win32") {
    candidates.push(
      "/opt/homebrew/share/scrcpy/scrcpy-server",
      "/usr/local/share/scrcpy/scrcpy-server",
      "/usr/share/scrcpy/scrcpy-server"
    )
  }
  for (const candidate of candidates) {
    if (await isFile(candidate)) return resolve(candidate)
  }
  if (process.platform === "win32" && scrcpyExePath) {
    const localAppData =
      process.env.LOCALAPPDATA || join(homedir(), "AppData/Local")
    const programData = process.env.ProgramData || "C:\\ProgramData"
    const scoopServer = join(homedir(), "scoop/apps/scrcpy/current/scrcpy-server")
    if (await isFile(scoopServer)) return resolve(scoopServer)

    const chocoTools = join(programData, "chocolatey/lib/scrcpy/tools")
    try {
      const entries = await readdir(chocoTools)
      for (const entry of entries) {
        const hit = join(chocoTools, entry, "scrcpy-server")
        if (await isFile(hit)) return resolve(hit)
      }
      const direct = join(chocoTools, "scrcpy-server")
      if (await isFile(direct)) return resolve(direct)
    } catch {
      /* ignore */
    }

    const packagesDir = join(localAppData, "Microsoft/WinGet/Packages")
    try {
      const entries = await readdir(packagesDir)
      for (const entry of entries) {
        if (!entry.startsWith("Genymobile.scrcpy")) continue
        const sub = join(packagesDir, entry)
        const children = await readdir(sub).catch(() => [])
        for (const child of children) {
          const hit = join(sub, child, "scrcpy-server")
          if (await isFile(hit)) return resolve(hit)
        }
        const direct = join(sub, "scrcpy-server")
        if (await isFile(direct)) return resolve(direct)
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

function parseScrcpyVersion(stdout) {
  const match = String(stdout || "").match(/^scrcpy[ \t]+(\d\S*)/im)
  return match ? match[1] : null
}

function parseAdbVersion(stdout) {
  const text = String(stdout || "")
  const platformToolsMatch = text.match(/^Version\s+([^\r\n]+)/m)
  if (platformToolsMatch) return platformToolsMatch[1].trim()
  const fallback = text.match(/Android Debug Bridge version\s+([^\r\n]+)/i)
  return fallback ? fallback[1].trim() : null
}

async function detectPackageManagerInfo() {
  if (process.platform === "win32") {
    const winget = await findExecutable(["winget.exe"])
    if (winget) return { name: "winget", path: winget.path }
    const scoop = await findExecutable(["scoop.cmd", "scoop.ps1"])
    if (scoop) return { name: "scoop", path: scoop.path }
    const choco = await findExecutable(["choco.exe"])
    if (choco) return { name: "choco", path: choco.path }
    return null
  }
  if (process.platform === "darwin") {
    const brew = await findExecutable(["brew"])
    if (brew) return { name: "brew", path: brew.path }
    return null
  }
  return null
}

async function detectPackageManager() {
  const info = await detectPackageManagerInfo()
  return info?.name || null
}

function failureDetail(result, fallback) {
  const detail = stripVTControlCharacters(
    result?.stderr?.trim() || result?.stdout?.trim() || ""
  )
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-8)
    .join("\n")
    .slice(-1200)
  return `${detail || fallback}（退出码 ${result?.code ?? "未知"}）。`
}

export function softwareService(run) {
  let cached = null
  let cacheAt = 0
  let reading = null

  const invalidate = () => {
    cached = null
    cacheAt = 0
  }

  const probe = async (customPath = "", signal) => {
    const custom = await resolveCustomInput(customPath)
    const [scrcpyHit, adbHit, packageManager] = await Promise.all([
      findExecutable(scrcpyNames, custom.dir),
      findExecutable(adbNames, custom.dir),
      detectPackageManager(),
    ])

    let scrcpyVersion = null
    let adbVersion = null
    let scrcpyUsable = false
    let adbUsable = false
    const issues = []
    if (!custom.valid && custom.issue) issues.push(custom.issue)

    if (scrcpyHit) {
      try {
        const res = await run(scrcpyHit.path, ["--version"], {
          signal,
          timeoutMs: 8000,
          label: "检测 scrcpy 版本",
        })
        if (res.code === 0) {
          scrcpyVersion = parseScrcpyVersion(res.stdout)
          scrcpyUsable = true
        } else {
          issues.push(failureDetail(res, "scrcpy --version 执行失败"))
        }
      } catch (error) {
        if (
          signal?.aborted ||
          error?.name === "AbortError" ||
          /aborted/i.test(error?.message || "")
        ) {
          throw error
        }
        issues.push(error instanceof Error ? error.message : String(error))
      }
    }

    if (adbHit) {
      try {
        const res = await run(adbHit.path, ["version"], {
          signal,
          timeoutMs: 8000,
          label: "检测 adb 版本",
        })
        if (res.code === 0) {
          adbVersion = parseAdbVersion(res.stdout)
          adbUsable = true
        } else {
          issues.push(failureDetail(res, "adb version 执行失败"))
        }
      } catch (error) {
        if (
          signal?.aborted ||
          error?.name === "AbortError" ||
          /aborted/i.test(error?.message || "")
        ) {
          throw error
        }
        issues.push(error instanceof Error ? error.message : String(error))
      }
    }

    const serverPath = await findScrcpyServer(
      scrcpyHit?.path || null,
      custom.dir
    )

    let state = "not-installed"
    if (scrcpyUsable && adbUsable && serverPath) {
      state = "ready"
    } else if (scrcpyUsable || adbUsable) {
      state = "partial"
      if (!adbUsable) issues.push("未检测到可用的 adb，设备连接与观察不可用。")
      if (!scrcpyUsable) issues.push("未检测到可用的 scrcpy，无法拉起原生投屏窗口。")
      else if (!serverPath)
        issues.push("未找到配套 scrcpy-server，AI 控制将降级为 ADB 输入。")
    } else if (scrcpyHit || adbHit) {
      state = "unavailable"
    } else {
      issues.push("未检测到 scrcpy 与 adb。请点击「安装」或在下方填写已解压目录。")
    }
    if (scrcpyUsable && serverPath && scrcpyVersion !== SCRCPY_CONTROL_VERSION) {
      issues.push(
        `轻量控制通道需要 scrcpy ${SCRCPY_CONTROL_VERSION}，可用的操作将降级为 ADB 输入。`
      )
    }

    const source = scrcpyHit?.source || adbHit?.source || null

    return {
      state,
      source,
      packageManager,
      scrcpyVersion,
      adbVersion,
      scrcpyPath: scrcpyHit?.path || null,
      adbPath: adbHit?.path || null,
      serverPath,
      usable: adbUsable,
      canMirror: scrcpyUsable && adbUsable,
      issue: issues.join(" "),
    }
  }

  const read = async (options = {}, signal) => {
    const customPath = options.customPath || ""
    const force = Boolean(options.force)
    if (!force && cached && Date.now() - cacheAt < 4000) {
      return cached
    }
    if (!force && reading) return reading
    reading = probe(customPath, signal).then(
      (result) => {
        if (result.state === "ready" || result.state === "partial") {
          cached = result
          cacheAt = Date.now()
        }
        reading = null
        return result
      },
      (error) => {
        reading = null
        throw error
      }
    )
    return reading
  }

  const manage = async (action, options = {}) => {
    const current = await read({ customPath: options.customPath, force: true })
    if (
      (action === "upgrade" || action === "uninstall") &&
      current.source === "custom"
    ) {
      throw new Error(
        "当前使用的是自定义目录中的 scrcpy，不由系统包管理器管理。如需升级，请直接更新该目录，或清空自定义路径后通过系统包管理器安装。"
      )
    }
    const pmInfo = await detectPackageManagerInfo()
    const pm = pmInfo?.name || null
    if (!pm) {
      throw new Error(
        process.platform === "win32"
          ? "当前系统未检测到可用的包管理器（winget / scoop / choco）。请从 GitHub 官方下载 scrcpy 解压后在下方填写目录路径。"
          : "当前系统未检测到可用的包管理器（brew），请手动安装 scrcpy 与 adb 后刷新。"
      )
    }

    const commands = {
      winget: {
        install: [
          "winget",
          [
            "install",
            "--exact",
            "Genymobile.scrcpy",
            "--disable-interactivity",
            "--accept-source-agreements",
            "--accept-package-agreements",
          ],
        ],
        upgrade: [
          "winget",
          [
            "upgrade",
            "--exact",
            "Genymobile.scrcpy",
            "--disable-interactivity",
            "--accept-source-agreements",
            "--accept-package-agreements",
          ],
        ],
        uninstall: [
          "winget",
          [
            "uninstall",
            "--exact",
            "Genymobile.scrcpy",
            "--disable-interactivity",
          ],
        ],
      },
      scoop: {
        install: ["scoop", ["install", "scrcpy", "adb"]],
        upgrade: ["scoop", ["update", "scrcpy", "adb"]],
        uninstall: ["scoop", ["uninstall", "scrcpy"]],
      },
      choco: {
        install: ["choco", ["install", "scrcpy", "adb", "-y", "--no-progress"]],
        upgrade: ["choco", ["upgrade", "scrcpy", "adb", "-y", "--no-progress"]],
        uninstall: ["choco", ["uninstall", "scrcpy", "-y", "--no-progress"]],
      },
      brew: {
        install: ["brew", ["install", "scrcpy"]],
        upgrade: ["brew", ["upgrade", "scrcpy"]],
        uninstall: ["brew", ["uninstall", "scrcpy"]],
      },
    }

    const spec = commands[pm]?.[action]
    if (!spec) throw new Error(`不支持的管理动作：${action}`)

    const [defaultBin, args] = spec
    const bin = pmInfo?.path || defaultBin
    options.onOutput?.(`$ ${pm} ${args.join(" ")}\n`, "stdout")
    const res = await run(bin, args, {
      signal: options.signal,
      onOutput: options.onOutput,
      timeoutMs: 900000,
      label: `${pm} ${action} scrcpy`,
    })
    invalidate()
    if (res.code !== 0) {
      const rawMsg = `${res.stderr || ""}\n${res.stdout || ""}`
      if (/ReadKeyTimeout|Console\.ReadKey/i.test(rawMsg)) {
        throw new Error(
          `${pm} 尝试弹出交互确认，但后台进程无交互控制台（通常是因为当前 scrcpy 并非通过 ${pm} 安装，或需要管理员权限）。请先在管理员终端中手动执行 ${bin} ${args.join(" ")}。`
        )
      }
      throw new Error(failureDetail(res, `${pm} ${action} scrcpy 失败`))
    }
    return read({ customPath: options.customPath, force: true })
  }

  return {
    read,
    manage,
    invalidate,
  }
}
