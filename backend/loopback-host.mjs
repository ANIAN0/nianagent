// @ts-check
// 内置插件本机回环托管的公共构件：子进程监管与 JSON 响应。
// Host/Origin 校验由各插件执行（MCP 使用官方 SDK 校验器），此处只沉淀双方重复的实现。
import { spawn } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { createServer } from "node:net"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { replaceJson } from "./atomic-file.mjs"
import { redactSensitive } from "./redact.mjs"
import {
  workbenchDirectories,
  workbenchSettingsFile,
  readWorkbenchSettings,
} from "./workbench-settings.mjs"
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

// 健康接口超时也可能是端口已占用。只有成功绑定回环地址才尝试启动。
async function portIsFree(port) {
  const listener = createServer()
  return new Promise((done, reject) => {
    listener.once("error", (error) => {
      if ("code" in error && error.code === "EADDRINUSE") done(false)
      else reject(error)
    })
    listener.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      listener.close(() => done(true))
    )
  })
}

export function createWorkbenchSupervisor(plugins, logs) {
  const dataDirs = workbenchDirectories(resolve(plugins))
  const settingsFile = workbenchSettingsFile(plugins)
  const label = "共享工作台"
  let settings
  let loading
  const loadSettings = async () => {
    if (!settings) {
      loading ??= readWorkbenchSettings(plugins)
        .then((value) => {
          settings = value
        })
        .finally(() => {
          loading = undefined
        })
      await loading
    }
  }

  let child = null
  let external = false
  let running = false
  let issue = ""
  let closed = false
  let connecting
  let changing
  let releasing
  let closing
  const activeModules = new Set()
  const lifecycle = new AbortController()

  const event = async (statusText, error = "") => {
    try {
      await logs?.append?.({
        source: "workbench",
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
        redirect: "error",
      })
      if (!response.ok) return false
      const body = await response.json().catch(() => null)
      return (
        body?.ok === true &&
        body.app === "moon-workbench" &&
        body.port === port &&
        Object.entries(dataDirs).every(([kind, directory]) => {
          const actual = body.dataDirs?.[kind]
          return (
            typeof actual === "string" &&
            isAbsolute(actual) &&
            relative(actual, directory) === ""
          )
        })
      )
    } catch {
      return false
    }
  }

  const startChild = async (port) => {
    // 默认走版本化 standalone 产物（支持运行中构建新版后「重启服务」无缝切换，无 Windows EBUSY 锁）；
    // 设置 MOON_WORKBENCH_DEV=1 可使用 Next 开发服务。
    const devEnv = (process.env.MOON_WORKBENCH_DEV || "").trim()
    const packaged = process.env.MOON_DESKTOP_PACKAGED === "1"
    const devMode =
      !packaged &&
      devEnv
        .split(",")
        .some((value) => ["1", "notes", "skills"].includes(value.trim()))
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
      MOON_NOTES_DATA_DIR: dataDirs.notes,
      MOON_SKILLS_DATA_DIR: dataDirs.skills,
      MOON_WORKBENCH_PORT: String(port),
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
        child = null
        running = false
        if (!closed && code !== 0 && code !== null) {
          issue = `独立工作台进程已退出（code=${code}）`
          void event("exited", issue)
        }
      }
    })

    const deadline = Date.now() + 25_000
    while (!closed && Date.now() < deadline) {
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
    external = false
    running = false
    await killTree(current)
  }

  const canReuse = async (port) => {
    if (await probeHealth(port)) return true
    if (!(await portIsFree(port)))
      throw new Error(
        `${label}端口 ${port} 已占用，无法确认工作台类型和数据目录。`
      )
    return false
  }

  const connect = async (port) =>
    (await canReuse(port)) ? null : startChild(port)

  const adopt = (proc) => {
    child = proc
    external = proc === null
    running = true
    issue = ""
  }

  const restartChild = async () => {
    if (external && (await probeHealth())) {
      if (running) throw new Error("工作台由外部启动，请在原启动处重启。")
      adopt(null)
      return
    }
    await stopChild()
    try {
      adopt(await connect(settings.port))
    } catch (error) {
      issue = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  // 注册插件只创建模块入口；第一次打开详情或调用工具时才连接。
  let attempted = false
  const ensureRunning = async () => {
    await loadSettings()
    await releasing
    if (closed || changing) return false
    if (connecting) return connecting
    if (attempted) {
      const port = settings.port
      const healthy = Boolean(child || external) && (await probeHealth(port))
      if (closed || changing || settings.port !== port) return false
      running = healthy
      return healthy
    }
    attempted = true
    connecting = (async () => {
      try {
        adopt(await connect(settings.port))
        await event(external ? "connected" : "started")
        return !closed
      } catch (error) {
        issue = error instanceof Error ? error.message : String(error)
        await event("start_failed", issue)
        return false
      }
    })().finally(() => {
      connecting = undefined
    })
    return connecting
  }

  const statusValue = (kind, healthy) => ({
    running: healthy,
    url: `${baseUrl()}/${kind}`,
    port: settings.port,
    revision: settings.revision,
    issue:
      issue ||
      (external && !healthy ? "外部工作台连接已断开，请重新连接。" : ""),
    logIssue: logs?.issue || "",
  })

  const change = (action) => {
    if (changing || closed) {
      throw new Error(`${label}正在变更或停止。`)
    }
    changing = Promise.resolve()
      .then(async () => {
        await loadSettings()
        await releasing
        await connecting
        if (closed) throw new Error("共享工作台正在关闭。")
        return action()
      })
      .finally(() => {
        changing = undefined
      })
    return changing
  }

  function forModule(kind, operationsSpec) {
    let paused = false
    const moduleToken = Symbol(kind)
    activeModules.add(moduleToken)
    const operation = (name, action) => ({
      ...operationsSpec[name],
      async execute(input, _context, signal) {
        if (paused || closed) throw new Error("插件已暂停或停止。")
        return { value: await action(input, signal) }
      },
    })

    const baseOperations = {
      status: operation("status", async () =>
        statusValue(kind, await ensureRunning())
      ),
      reload: operation("reload", () =>
        change(async () => {
          attempted = true
          await restartChild()
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
          if (!child && (await probeHealth())) {
            adopt(null)
            attempted = true
            throw new Error("工作台由外部启动，请在原启动处更改端口。")
          }
          const next = { port: input.port, revision: settings.revision + 1 }
          if (next.port === settings.port) {
            await replaceJson(settingsFile, next, { signal })
          } else {
            // 先查目标端口，停止旧进程后再启动。写配置失败则恢复旧监听。
            await canReuse(next.port)
            signal.throwIfAborted()
            const restore = Boolean(child)
            await stopChild()
            attempted = true
            try {
              adopt(await connect(next.port))
              await replaceJson(settingsFile, next, { signal })
            } catch (error) {
              await stopChild()
              issue = error instanceof Error ? error.message : String(error)
              if (restore && !closed) await restartChild()
              throw error
            }
          }
          settings = next
          return statusValue(kind, running)
        })
      ),
    }

    return {
      isRunning: async () => !paused && (await ensureRunning()) && !paused,
      baseUrl,
      baseOperations,
      statusText: () =>
        issue || (running ? `共享工作台 ${settings.port}` : "按需连接"),
      quiesce() {
        paused = true
      },
      resume() {
        paused = false
      },
      async close() {
        paused = true
        if (!activeModules.delete(moduleToken)) return
        if (activeModules.size > 0 || closed) return
        // 所有工作台模块均已停用：回收 Moon 自启的子进程，不干涉外部进程。
        await changing?.catch(() => {})
        await connecting
        if (activeModules.size > 0 || closed) return
        attempted = false
        issue = ""
        if (!external && child) {
          releasing = stopChild().finally(() => {
            releasing = undefined
          })
          await releasing
          await event("stopped")
        } else if (external) {
          external = false
          running = false
        }
      },
    }
  }

  return {
    forModule,
    close() {
      if (closing) return closing
      closed = true
      lifecycle.abort()
      closing = (async () => {
        await changing?.catch(() => {})
        await connecting
        await releasing
        await stopChild()
        if (attempted) await event("stopped")
      })()
      return closing
    },
  }
}
