// @ts-check
// 内置插件本机回环托管的公共构件：子进程监管与 JSON 响应。
// Host/Origin 校验由各插件执行（MCP 使用官方 SDK 校验器），此处只沉淀双方重复的实现。
import { spawn } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { replaceJson } from "./atomic-file.mjs"
import { redactSensitive } from "./redact.mjs"
import { packagedWorkbenchEntry, workbenchAppPath } from "./workbench-paths.mjs"

/** 读取带兜底的 JSON 配置文件：缺失返回 fallback，损坏抛出保留原文的中文错误。 */
export async function readSavedJson(file, fallback, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return fallback
    throw new Error(`${label}配置无法读取，原文件已保留。`, { cause: error })
  }
}

export const sendJson = (res, status, value) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  })
  res.end(JSON.stringify(value ?? {}))
}

/* 页面不外联：脚本与样式内联，数据只回本机 API；外部图片媒体按真实页面需要放行。 */
export const pageHeaders = (extra = {}) => ({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  ...extra,
})

export const moduleHeaders = {
  "content-type": "text/javascript; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
}

const sharedDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(sharedDir, "..")
const workbenchAppDir = join(repoRoot, workbenchAppPath)
const workbenchReleasesPointer = join(
  workbenchAppDir,
  ".releases",
  "current.json"
)
const workbenchLegacyStandaloneEntry = join(
  workbenchAppDir,
  ".next",
  "standalone",
  workbenchAppPath,
  "server.js"
)

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const resolveStandaloneEntry = async () => {
  try {
    const pointer = JSON.parse(await readFile(workbenchReleasesPointer, "utf8"))
    if (typeof pointer?.entry === "string" && pointer.entry.trim()) {
      const candidate = resolve(workbenchAppDir, pointer.entry)
      if (await exists(candidate)) return candidate
    }
  } catch {
    /* 无 release 指针时回退到旧路径 */
  }
  if (await exists(workbenchLegacyStandaloneEntry)) {
    return workbenchLegacyStandaloneEntry
  }
  return null
}

const pause = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return
  const pid = child.pid
  if (!pid) return
  if (process.platform === "win32") {
    await new Promise((resolvePromise) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.once("exit", () => resolvePromise(undefined))
      killer.once("error", () => resolvePromise(undefined))
    })
  } else {
    try {
      child.kill("SIGTERM")
    } catch {
      /* ignore */
    }
    await Promise.race([
      new Promise((resolvePromise) => child.once("exit", resolvePromise)),
      pause(3000),
    ])
    if (child.exitCode === null) {
      try {
        child.kill("SIGKILL")
      } catch {
        /* ignore */
      }
    }
  }
}

export async function createWorkbenchSupervisor({
  appKind,
  pluginId,
  label,
  logSource,
  defaultPort,
  host,
  operationsSpec,
  extraEnv = {},
  onClose,
}) {
  const settingsFile = join(host.directory, "settings.json")
  let settings = await readSavedJson(
    settingsFile,
    { revision: 0, port: defaultPort },
    label
  )
  if (
    !Number.isSafeInteger(settings.revision) ||
    !Number.isInteger(settings.port) ||
    settings.port < 1024 ||
    settings.port > 65535
  ) {
    throw new Error(`${label}配置无效，原文件保留。`)
  }

  let child = null
  let running = false
  let issue = ""
  let closed = false
  let frozen = false
  let changing
  let closing
  const lifecycle = new AbortController()

  const event = async (statusText, error = "") => {
    try {
      await host.logs?.append?.({
        source: logSource,
        plugin: pluginId,
        status: statusText,
        error,
      })
    } catch {
      /* 日志失败不影响主流程 */
    }
  }

  const baseUrl = () => `http://127.0.0.1:${settings.port}`

  const probeHealth = async (port = settings.port, timeoutMs = 1500) => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) return false
      const body = await response.json().catch(() => null)
      return body?.ok === true && body.app === appKind && body.port === port
    } catch {
      return false
    }
  }

  const startChild = async (port) => {
    // 默认走版本化 standalone 产物（支持运行中构建新版后「重启服务」无缝切换，无 Windows EBUSY 锁）；
    // 需要频繁调单插件 UI 时可定向设置 MOON_WORKBENCH_DEV=skills 或 notes 开启 next dev。
    const devEnv = (process.env.MOON_WORKBENCH_DEV || "").trim()
    const packaged = process.env.MOON_DESKTOP_PACKAGED === "1"
    const devMode =
      !packaged &&
      (devEnv === "1" ||
        devEnv
          .split(",")
          .map((s) => s.trim())
          .includes(appKind))
    const packagedEntry = join(sharedDir, packagedWorkbenchEntry)
    if (packaged && !(await exists(packagedEntry))) {
      throw new Error(`缺少随包工作台入口：${packagedWorkbenchEntry}`)
    }
    const standaloneEntry = packaged
      ? packagedEntry
      : devMode
        ? null
        : await resolveStandaloneEntry()
    const env = {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      MOON_WORKBENCH_BACKEND_DIR: sharedDir,
      MOON_WORKBENCH_APP: appKind,
      MOON_WORKBENCH_DATA_DIR: host.directory,
      MOON_WORKBENCH_PORT: String(port),
      ...extraEnv,
    }

    let proc
    if (!devMode && standaloneEntry) {
      proc = spawn(process.execPath, [standaloneEntry], {
        cwd: dirname(standaloneEntry),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
    } else {
      const nextBin = join(
        workbenchAppDir,
        "node_modules",
        "next",
        "dist",
        "bin",
        "next"
      )
      proc = spawn(
        process.execPath,
        [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
        {
          cwd: workbenchAppDir,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        }
      )
    }

    const launch = { error: /** @type {NodeJS.ErrnoException | null} */ (null) }
    proc.once("error", (error) => {
      launch.error = error
    })
    let stderrTail = ""
    proc.stderr?.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-1200)
    })
    proc.stdout?.resume()
    proc.on("exit", (code) => {
      if (child === proc) {
        running = false
        if (!closed && code !== 0 && code !== null) {
          issue = `独立工作台进程已退出（code=${code}）`
          void event("exited", issue)
        }
      }
    })

    const deadline = Date.now() + 25_000
    while (Date.now() < deadline) {
      if (launch.error) {
        throw new Error(
          `无法启动独立工作台：${launch.error.code ?? launch.error.message}`
        )
      }
      if (proc.exitCode !== null) {
        throw new Error(
          `独立工作台启动失败（code=${proc.exitCode}）：${redactSensitive(
            stderrTail.trim() || "请检查端口或构建产物。"
          )}`
        )
      }
      if (await probeHealth(port, 1000)) {
        return proc
      }
      await pause(300)
    }
    await killTree(proc)
    throw new Error("独立工作台启动超时，未通过 /api/health 检查。")
  }

  const stopChild = async () => {
    const current = child
    child = null
    running = false
    await killTree(current)
  }

  const restartChild = async (port = settings.port) => {
    await stopChild()
    const nextProc = await startChild(port)
    child = nextProc
    running = true
    issue = ""
  }

  try {
    await restartChild(settings.port)
    await event("started")
  } catch (error) {
    issue = error instanceof Error ? error.message : String(error)
    running = false
    await event("start_failed", issue)
  }

  const status = async () => {
    const healthy =
      child && child.exitCode === null ? await probeHealth() : false
    running = healthy
    return {
      running: healthy && !frozen,
      url: `${baseUrl()}/${appKind}`,
      port: settings.port,
      revision: settings.revision,
      issue,
      logIssue: host.logs?.issue || "",
    }
  }

  const change = (action) => {
    if (changing || closed || frozen) {
      throw new Error(`${label}正在变更或停止。`)
    }
    changing = Promise.resolve()
      .then(action)
      .finally(() => {
        changing = undefined
      })
    return changing
  }

  const operation = (name, action) => ({
    ...operationsSpec[name],
    execute: async (input, _context, signal) => ({
      value: await action(input, signal),
    }),
  })

  const baseOperations = {
    status: operation("status", status),
    reload: operation("reload", () =>
      change(async () => {
        await restartChild(settings.port)
        await event("restarted")
        return { version: Date.now() }
      })
    ),
    save: operation("save", (input, signal) =>
      change(async () => {
        signal = AbortSignal.any([
          lifecycle.signal,
          ...(signal ? [signal] : []),
        ])
        if (input.revision !== settings.revision) {
          throw new Error("配置已变化，请重新读取。")
        }
        signal?.throwIfAborted()
        const next = { port: input.port, revision: settings.revision + 1 }
        await replaceJson(settingsFile, next, { signal })
        settings = next
        await restartChild(settings.port)
        return status()
      })
    ),
  }

  return {
    get port() {
      return settings.port
    },
    get running() {
      return running && !frozen
    },
    baseUrl,
    baseOperations,
    statusText: () =>
      issue ||
      (running && !frozen ? `独立工作台 ${settings.port}` : "服务已暂停"),
    async quiesce() {
      frozen = true
    },
    resume() {
      frozen = false
    },
    close() {
      if (closing) return closing
      closed = true
      frozen = true
      lifecycle.abort()
      closing = (async () => {
        await changing?.catch(() => {})
        await stopChild()
        await onClose?.()
        await event("stopped")
      })()
      return closing
    },
  }
}
