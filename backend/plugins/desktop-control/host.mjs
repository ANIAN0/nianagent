import { spawn } from "node:child_process"
import { mkdir, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { desktopControlOperations } from "./contract.mjs"
import { softwareService } from "./software.mjs"
import {
  actInputSchema,
  formatDesktopToolResult,
  observeInputSchema,
  summarizeDesktopControl,
  validateCommandPolicy,
} from "./tool-result.mjs"

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

function runChildProcess(binary, args, options = {}) {
  const {
    cwd,
    env = process.env,
    signal,
    timeoutMs = 30000,
    stdinText,
    label = "agent-desktop",
  } = options

  signal?.throwIfAborted()

  const child = spawn(binary, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  })

  return new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      fn(value)
    }

    const onAbort = () => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish(reject, signal.reason || new Error(`${label} 已取消。`))
    }

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish(reject, new Error(`${label} 执行超时（${timeoutMs}ms）。`))
    }, timeoutMs)

    signal?.addEventListener("abort", onAbort, { once: true })

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")

    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk
        if (stdout.length > MAX_OUTPUT_BYTES) {
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES)
        }
      }
    })

    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-32768)
    })

    child.once("error", (error) => {
      finish(reject, new Error(`${label} 启动失败：${error.message}`))
    })

    child.once("close", (code) => {
      if (!timedOut) {
        finish(resolve, { code: code ?? 1, stdout, stderr })
      }
    })

    child.stdin.on("error", (error) => {
      // A CLI that rejects argv can exit without reading its input.
      if (error.code !== "EPIPE") finish(reject, error)
    })
    child.stdin.end(stdinText, "utf8")
  })
}

function parseJsonEnvelope(stdout) {
  const text = (stdout || "").trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function activate(host) {
  let closed = false
  let frozen = false
  let management = null
  let job = null
  const lifecycle = new AbortController()
  const stateRoot = join(host.directory, "agent-desktop-home")
  // The CLI creates stateRoot with its required private ACL on first use.
  const exportsRoot = join(stateRoot, "exports")

  const sessionsByChat = new Map()
  const sessionCreation = new Map()
  const overlays = new Map()

  const config = {
    readOnly: Boolean(host.configuration?.readOnly),
    allowHeaded: Boolean(host.configuration?.allowHeaded),
    allowClipboard: Boolean(host.configuration?.allowClipboard),
    allowAppLifecycle:
      host.configuration?.allowAppLifecycle === undefined
        ? true
        : Boolean(host.configuration.allowAppLifecycle),
    cursorOverlay:
      host.configuration?.cursorOverlay === undefined
        ? true
        : Boolean(host.configuration.cursorOverlay),
    recordTrace:
      host.configuration?.recordTrace === undefined
        ? true
        : Boolean(host.configuration.recordTrace),
    recordScreenshots: Boolean(host.configuration?.recordScreenshots),
  }

  const ensureAvailable = () => {
    if (closed) throw new Error("桌面控制插件已停用。")
    if (frozen) throw new Error("Moon 正在维护，桌面控制暂不接受新请求。")
  }

  const run = (binary, args, options = {}) => {
    if (closed) throw new Error("桌面控制插件已停用。")
    const signal = options.signal
      ? AbortSignal.any([options.signal, lifecycle.signal])
      : lifecycle.signal
    return runChildProcess(binary, args, {
      cwd: options.cwd || host.directory,
      env: {
        ...process.env,
        ...(options.env || {}),
        AGENT_DESKTOP_SESSION: undefined,
        AGENT_DESKTOP_AGENT_ID: undefined,
        AGENT_DESKTOP_HOME: stateRoot,
      },
      signal,
      timeoutMs: options.timeoutMs ?? 30000,
      stdinText: options.stdinText,
      label: options.label,
    })
  }

  const software = softwareService(run)

  const runCli = async (info, args, options = {}) => {
    if (!info?.usable || !info?.cliPath) {
      throw new Error(
        info?.issue || "尚未安装可用的 agent-desktop CLI，请先在插件页安装。"
      )
    }
    return run(info.cliPath, args, options)
  }

  const scanHostedSessions = async (selectedId) => {
    const dir = join(stateRoot, "sessions")
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      return {
        activeCount: 0,
        endedCount: 0,
        latestSessionId: null,
        latestTraceAvailable: false,
      }
    }
    let activeCount = 0
    let endedCount = 0
    let latest = null
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(entry.name)
      )
        continue
      const manifestPath = join(dir, entry.name, "session.json")
      try {
        const raw = JSON.parse(await readFile(manifestPath, "utf8"))
        if (raw.id !== entry.name) continue
        const ended = Number.isFinite(raw.ended_at)
        if (ended) endedCount += 1
        else activeCount += 1
        if (selectedId && selectedId !== entry.name) continue
        const createdAt = Number(raw.created_at) || 0
        const traceDir = join(dir, entry.name, "trace")
        let hasTrace = false
        try {
          const traceFiles = await readdir(traceDir)
          hasTrace = traceFiles.some((file) => file.endsWith(".jsonl"))
        } catch {
          hasTrace = false
        }
        if (
          !latest ||
          (hasTrace && !latest.hasTrace) ||
          (hasTrace === latest.hasTrace && createdAt > latest.createdAt)
        ) {
          latest = {
            id: entry.name,
            createdAt,
            hasTrace,
          }
        }
      } catch {
        /* ignore malformed session dir */
      }
    }
    return {
      activeCount,
      endedCount,
      latestSessionId: latest?.id ?? null,
      latestTraceAvailable: Boolean(latest?.hasTrace),
    }
  }

  const sessionKey = (context) => {
    const identity =
      context?.source === "mcp"
        ? ["mcp", context.actorId, context.credentialId]
        : ["chat", context?.profileId, context?.sessionId]
    if (!identity[2]) throw new Error("桌面操作缺少已授权的会话身份。")
    return JSON.stringify(identity)
  }

  const ensureChatSession = async (info, context, signal) => {
    const key = sessionKey(context)
    signal?.throwIfAborted()
    const existing = sessionsByChat.get(key)
    if (existing) return existing
    if (sessionCreation.has(key)) return sessionCreation.get(key)

    const creating = (async () => {
      const name = context?.source === "mcp" ? "moon-mcp" : "moon-chat"
      const args = ["session", "start", "--name", name]
      if (!config.recordTrace) args.push("--no-trace")
      if (config.recordTrace && config.recordScreenshots)
        args.push("--screenshots")

      const result = await runCli(info, args, {
        timeoutMs: 10000,
        label: "创建桌面会话",
      })
      const envelope = parseJsonEnvelope(result.stdout)
      if (result.code !== 0 || !envelope?.ok || !envelope?.data?.session_id) {
        throw new Error(envelope?.error?.message || "创建托管桌面会话失败。")
      }
      const sessionId = envelope.data.session_id
      sessionsByChat.set(key, sessionId)
      return sessionId
    })().finally(() => {
      sessionCreation.delete(key)
    })
    sessionCreation.set(key, creating)
    return creating
  }

  const readStatus = async (signal) => {
    const info = await software.detect(signal)
    const checkVersion = info.npm
      ? software.latest(info, signal).catch(() => signal?.throwIfAborted())
      : null
    const sessions = await scanHostedSessions()

    let environment = {
      platform: process.platform,
      ok: false,
      supportedSurfaces: [],
      permissions: null,
      stateRoot,
      issue: "",
    }

    if (info.usable) {
      try {
        const res = await runCli(info, ["status"], {
          signal,
          timeoutMs: 10000,
          label: "读取桌面环境状态",
        })
        const envelope = parseJsonEnvelope(res.stdout)
        if (res.code === 0 && envelope?.ok && envelope.data) {
          const data = envelope.data
          const surfaces = Array.isArray(data.supported_surfaces)
            ? data.supported_surfaces
            : []
          const permissions = data.permissions || null
          const accDenied = permissions?.accessibility?.state === "denied"
          environment = {
            platform: data.platform || process.platform,
            ok:
              surfaces.length > 0 &&
              !accDenied &&
              data.adapter_healthy !== false,
            supportedSurfaces: surfaces,
            permissions,
            stateRoot: data.state_root || stateRoot,
            issue: accDenied
              ? permissions?.accessibility?.suggestion ||
                "缺少系统辅助功能权限，请授权后重试。"
              : surfaces.length === 0
                ? "未检测到可用的无障碍表面，请确认处于当前用户交互桌面会话中。"
                : "",
          }
        } else {
          environment.issue =
            envelope?.error?.message || "无法读取 agent-desktop 环境状态。"
        }
      } catch (error) {
        if (error.name === "AbortError") throw error
        environment.issue = error.message
      }
    } else {
      environment.issue =
        info.state === "not-installed"
          ? "尚未安装 agent-desktop CLI。"
          : info.issue || "agent-desktop CLI 当前不可用。"
    }

    const issue =
      job?.state === "failed"
        ? job.error
        : info.state === "unavailable"
          ? info.issue
          : environment.issue

    await checkVersion
    return {
      installation: software.summary(info),
      environment,
      sessions,
      operation: job,
      issue,
    }
  }

  const startManage = async (action) => {
    ensureAvailable()
    if (management || job?.state === "running") {
      throw new Error("当前已有 CLI 管理任务正在进行，请等待结束。")
    }
    const info = await software.detect(lifecycle.signal, true)
    if (!info.npm) {
      throw new Error(
        info.issue || "未检测到可用的 npm 环境，无法执行安装管理。"
      )
    }
    ensureAvailable()
    if (management || job?.state === "running") {
      throw new Error("当前已有 CLI 管理任务正在进行，请等待结束。")
    }
    if (action === "install" && info.state === "installed") {
      throw new Error("agent-desktop 已安装，如需更新请执行升级。")
    }
    if (
      (action === "upgrade" || action === "uninstall") &&
      info.source !== "npm"
    ) {
      throw new Error("当前未通过全局 npm 检测到 agent-desktop。")
    }

    const currentJob = {
      id: randomUUID(),
      action,
      state: "running",
      phase:
        action === "uninstall"
          ? "正在卸载全局 agent-desktop…"
          : "正在查询官方最新版本…",
      startedAt: new Date().toISOString(),
      endedAt: null,
      beforeVersion: info.version,
      targetVersion: null,
      error: "",
    }
    job = currentJob
    host.emit?.("status-changed", { reason: "management-started" })

    management = (async () => {
      try {
        let target = "latest"
        if (action !== "uninstall") {
          target = await software.latest(info, lifecycle.signal, true)
          currentJob.targetVersion = target
          currentJob.phase =
            action === "upgrade"
              ? `正在升级到 v${target}…`
              : `正在安装 v${target}…`
          host.emit?.("status-changed", { reason: "management-progress" })
        }
        const observed = await software.mutate(
          action,
          info,
          target,
          lifecycle.signal
        )
        if (
          action === "uninstall"
            ? observed.source === "npm" || observed.state === "unavailable"
            : observed.source !== "npm" ||
              !observed.usable ||
              observed.version !== target
        ) {
          throw new Error(
            observed.issue || "npm 已结束，但复查未确认目标版本状态。"
          )
        }
        currentJob.state = "succeeded"
        currentJob.phase =
          action === "uninstall"
            ? "已卸载 agent-desktop"
            : `已完成（v${target}）`
        currentJob.endedAt = new Date().toISOString()
      } catch (error) {
        currentJob.state = "failed"
        currentJob.phase = "操作未完成"
        currentJob.error =
          error instanceof Error ? error.message : String(error)
        currentJob.endedAt = new Date().toISOString()
      } finally {
        management = null
        host.emit?.("status-changed", { reason: "management-finished" })
      }
    })()

    return { operation: currentJob }
  }

  const endSession = async (info, sessionId) => {
    const result = await runChildProcess(
      info.cliPath,
      ["session", "end", sessionId],
      {
        cwd: host.directory,
        env: {
          ...process.env,
          AGENT_DESKTOP_SESSION: undefined,
          AGENT_DESKTOP_HOME: stateRoot,
        },
        timeoutMs: 3000,
        label: "结束桌面会话",
      }
    )
    if (result.code !== 0 || !parseJsonEnvelope(result.stdout)?.ok) {
      throw new Error("未能确认桌面会话已结束。")
    }
  }

  const executeToolCommand = async (mode, input, context, signal) => {
    ensureAvailable()
    if (management) throw new Error("CLI 正在维护，请等待任务结束。")
    const combinedSignal = signal
      ? AbortSignal.any([lifecycle.signal, signal])
      : lifecycle.signal
    const args = Array.isArray(input?.arguments) ? input.arguments : []
    const stdinText =
      typeof input?.stdinText === "string" ? input.stdinText : undefined
    const policy = validateCommandPolicy({
      mode,
      args,
      config,
      stdinText,
    })

    const info = await software.detect(combinedSignal)
    if (!info.usable) {
      throw new Error(
        info.issue || "尚未安装可用的 agent-desktop CLI，请先在插件页安装。"
      )
    }

    const finalArgs = [...args]
    const skipSession = ["version", "skills", "status", "permissions"].includes(
      policy.command
    )
    if (!skipSession) {
      const sessionId = await ensureChatSession(info, context, combinedSignal)
      finalArgs.unshift("--session", sessionId)
      if (mode === "act" && config.cursorOverlay) {
        if (!overlays.has(sessionId)) {
          overlays.set(
            sessionId,
            runCli(info, ["--session", sessionId, "cursor-overlay", "enable"], {
              timeoutMs: 3000,
              label: "启用桌面操作光标提示",
            }).catch(() => {})
          )
        }
        await overlays.get(sessionId)
      }
    }

    const res = await runCli(info, finalArgs, {
      signal: combinedSignal,
      timeoutMs: 60000,
      stdinText,
      label: `agent-desktop ${policy.command}`,
    })

    return formatDesktopToolResult({
      stdout: res.stdout,
      stderr: res.stderr,
      code: res.code,
      command: policy.command,
    })
  }

  const sharedTools = [
    {
      name: "desktop_observe",
      shareable: true,
      annotations: { readOnlyHint: true },
      description:
        '只读观察桌面窗口与无障碍树（snapshot / find / get / is / screenshot / list-apps / list-windows / list-surfaces / status / permissions / skills）。首次使用建议先调用 ["skills", "get", "desktop"] 与 ["skills", "get", "platform"] 了解引用与重试规范。',
      inputSchema: observeInputSchema,
      summarize: summarizeDesktopControl,
      execute: (input, context, signal) =>
        executeToolCommand("observe", input, context, signal),
    },
    {
      name: "desktop_act",
      shareable: true,
      annotations: { readOnlyHint: false, destructiveHint: true },
      description:
        "对桌面应用执行受控交互（click / set-value / type / press / scroll / launch / focus-window / wait / batch 等）。受插件安全策略（只读模式、--headed 物理输入、剪贴板、应用启停）守卫。输入敏感文本时优先传 stdinText 并配合 --stdin。",
      inputSchema: actInputSchema,
      summarize: summarizeDesktopControl,
      execute: (input, context, signal) =>
        executeToolCommand("act", input, context, signal),
    },
  ]

  const operation = (name, action) => ({
    ...desktopControlOperations[name],
    execute: async (input, _context, signal) => {
      ensureAvailable()
      const combined = signal
        ? AbortSignal.any([lifecycle.signal, signal])
        : lifecycle.signal
      return { value: await action(input || {}, combined) }
    },
  })

  return {
    sharedTools,
    async endChatSession(context) {
      if (closed) return
      const key = sessionKey(context)
      await sessionCreation.get(key)?.catch(() => {})
      const sessionId = sessionsByChat.get(key)
      if (!sessionId) return
      const info = await software.detect()
      if (closed || !info.usable) return
      await endSession(info, sessionId)
      sessionsByChat.delete(key)
      overlays.delete(sessionId)
      host.emit?.("status-changed", { reason: "session-ended" })
    },
    operations: {
      status: operation("status", (_input, signal) => readStatus(signal)),
      install: operation("install", () => startManage("install")),
      upgrade: operation("upgrade", () => startManage("upgrade")),
      uninstall: operation("uninstall", () => startManage("uninstall")),
      "probe-windows": operation("probe-windows", async (_input, signal) => {
        const info = await software.detect(signal)
        if (!info.usable) {
          return {
            ok: false,
            windowCount: 0,
            appCount: 0,
            checkedAt: new Date().toISOString(),
            issue: info.issue || "agent-desktop CLI 未安装或不可用。",
          }
        }
        try {
          const [winRes, appRes] = await Promise.all([
            runCli(info, ["list-windows"], {
              signal,
              timeoutMs: 12000,
              label: "探测可见窗口",
            }),
            runCli(info, ["list-apps"], {
              signal,
              timeoutMs: 12000,
              label: "探测运行中应用",
            }),
          ])
          const winEnv = parseJsonEnvelope(winRes.stdout)
          const appEnv = parseJsonEnvelope(appRes.stdout)
          const windows = Array.isArray(winEnv?.data) ? winEnv.data : []
          const apps = appEnv?.data?.apps
          if (
            winRes.code !== 0 ||
            appRes.code !== 0 ||
            !winEnv?.ok ||
            !appEnv?.ok ||
            !Array.isArray(winEnv.data) ||
            !Array.isArray(apps)
          ) {
            return {
              ok: false,
              windowCount: 0,
              appCount: Array.isArray(apps) ? apps.length : 0,
              checkedAt: new Date().toISOString(),
              issue:
                winEnv?.error?.message ||
                appEnv?.error?.message ||
                "读取窗口或应用列表失败，请检查桌面权限。",
            }
          }
          return {
            ok: true,
            windowCount: windows.length,
            appCount: apps.length,
            checkedAt: new Date().toISOString(),
            issue: "",
          }
        } catch (error) {
          signal?.throwIfAborted()
          return {
            ok: false,
            windowCount: 0,
            appCount: 0,
            checkedAt: new Date().toISOString(),
            issue: error instanceof Error ? error.message : String(error),
          }
        }
      }),
      "request-permissions": operation(
        "request-permissions",
        async (_input, signal) => {
          if (process.platform !== "darwin")
            throw new Error("当前平台无需请求系统辅助功能授权。")
          const info = await software.detect(signal)
          const res = await runCli(info, ["permissions", "--request"], {
            signal,
            timeoutMs: 20000,
            label: "请求系统权限",
          })
          const env = parseJsonEnvelope(res.stdout)
          if (res.code !== 0 || !env?.ok) {
            throw new Error(env?.error?.message || "请求系统权限失败。")
          }
          host.emit?.("status-changed", { reason: "permissions-updated" })
          return env.data
        }
      ),
      "guide-permissions": operation(
        "guide-permissions",
        async (_input, signal) => {
          if (process.platform !== "darwin")
            throw new Error("系统权限设置引导仅在 macOS 可用。")
          const info = await software.detect(signal)
          const res = await runCli(info, ["permissions", "--guide"], {
            signal,
            timeoutMs: 15000,
            label: "打开权限引导",
          })
          const env = parseJsonEnvelope(res.stdout)
          if (res.code !== 0 || !env?.ok) {
            throw new Error(
              env?.error?.message || "当前平台不支持系统权限设置引导。"
            )
          }
          return env.data
        }
      ),
      "export-trace": operation("export-trace", async (input, signal) => {
        const info = await software.detect(signal)
        const requestedId = input.sessionId?.trim()
        const sessions = await scanHostedSessions(requestedId)
        const sessionId = sessions.latestSessionId
        if (!sessionId || !sessions.latestTraceAvailable) {
          throw new Error("未找到可导出的托管会话追踪。")
        }
        await mkdir(exportsRoot, { recursive: true, mode: 0o700 })
        const outPath = join(
          exportsRoot,
          `trace-${sessionId}-${randomUUID()}.html`
        )
        const res = await runCli(
          info,
          ["--session", sessionId, "trace", "export", "--out", outPath],
          { signal, timeoutMs: 20000, label: "导出操作追踪" }
        )
        const env = parseJsonEnvelope(res.stdout)
        if (res.code !== 0 || !env?.ok) {
          throw new Error(env?.error?.message || "导出追踪报告失败。")
        }
        return { sessionId, path: outPath }
      }),
      "gc-sessions": operation("gc-sessions", async (_input, signal) => {
        const info = await software.detect(signal)
        const res = await runCli(info, ["session", "gc", "--ended"], {
          signal,
          timeoutMs: 15000,
          label: "清理旧会话",
        })
        const env = parseJsonEnvelope(res.stdout)
        if (res.code !== 0 || !env?.ok) {
          throw new Error(env?.error?.message || "清理已结束会话失败。")
        }
        if (!Array.isArray(env.data?.removed))
          throw new Error("CLI 未返回本次清理的会话列表。")
        const removedCount = env.data.removed.length
        host.emit?.("status-changed", { reason: "sessions-gc" })
        return { removedCount }
      }),
    },
    status: () => {
      if (job?.state === "running") return job.phase
      if (config.readOnly) return "只读模式"
      return "就绪"
    },
    quiesce() {
      frozen = true
    },
    resume() {
      if (!closed) frozen = false
    },
    async close() {
      closed = true
      frozen = true
      await Promise.allSettled(sessionCreation.values())
      const info = sessionsByChat.size
        ? await software.detect().catch(() => null)
        : null
      lifecycle.abort()
      await Promise.allSettled(overlays.values())
      if (info?.usable) {
        await Promise.allSettled(
          [...sessionsByChat.values()].map((id) => endSession(info, id))
        )
      }
      sessionsByChat.clear()
      overlays.clear()
    },
  }
}
