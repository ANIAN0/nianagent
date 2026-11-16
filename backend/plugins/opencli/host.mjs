import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createConnection } from "node:net"
import { randomUUID } from "node:crypto"
import { managedProcess } from "./processes.mjs"
import { softwareService } from "./software.mjs"
import {
  openCliArguments,
  openCliBrowserCommand,
  summarizeOpenCli,
  toolResult,
} from "./tool-result.mjs"

import { openCliOperations, openCliManagement } from "./contract.mjs"

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function bounded(promise, ms, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
async function status(profile = "", timeoutMs = 1500) {
  const url = new URL("http://127.0.0.1:19825/status")
  if (profile) url.searchParams.set("contextId", profile)
  try {
    const response = await fetch(url, {
      headers: { "X-OpenCLI": "1" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    })
    if (!response.ok) return null
    const value = await response.json()
    return Number.isSafeInteger(value.pid) &&
      value.pid > 0 &&
      typeof value.daemonVersion === "string" &&
      typeof value.extensionConnected === "boolean"
      ? value
      : null
  } catch {
    return null
  }
}
async function occupied() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: 19825 })
    const finish = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
    socket.setTimeout(1500, () => finish(true))
  })
}
function failure(result) {
  const message = result.stderr
    .trim()
    .split("\n")
    .slice(-3)
    .join(" ")
    .slice(0, 700)
    .replace(/Bearer\s+\S+/gi, "Bearer [隐藏]")
    .replace(
      /((?:token|password|secret|api[-_]?key)\s*[=:]\s*)\S+/gi,
      "$1[隐藏]"
    )
  return new Error(message || "官方OpenCLI未成功结束，请核对连接和原操作结果。")
}

async function aliases() {
  try {
    const directory =
      process.env.OPENCLI_CONFIG_DIR || join(homedir(), ".opencli")
    const value = JSON.parse(
      await readFile(join(directory, "browser-profiles.json"), "utf8")
    )
    return Object.fromEntries(
      Object.entries(value.aliases || {}).filter(
        ([alias, context]) =>
          alias.trim() && typeof context === "string" && context.trim()
      )
    )
  } catch (error) {
    if (error.code === "ENOENT") return {}
    throw new Error("官方浏览器连接别名无法读取，请检查全局配置。", {
      cause: error,
    })
  }
}

export async function activate(host) {
  let closed = false,
    frozen = false,
    daemon,
    starting,
    management,
    control,
    job = null,
    capabilities
  let business = "官方全局OpenCLI；尚未读取安装和后台状态。"
  const clients = new Set(),
    tools = new Set(),
    tasks = new Map(),
    used = new Map()
  const confirmedStops = new Set()
  let explicitDaemonPid
  const lifecycle = new AbortController()
  const owner = randomUUID().replaceAll("-", "")
  const taskFor = (context) => {
    const key = context.profileId + ":" + context.sessionId
    if (!tasks.has(key))
      tasks.set(key, "moon-" + owner + "-" + context.sessionId)
    return tasks.get(key)
  }
  const available = () => {
    if (closed) throw new Error("OpenCLI插件已停用。")
    if (frozen) throw new Error("Moon正在维护，OpenCLI暂不接受新操作。")
    if (management) throw new Error("OpenCLI管理操作正在进行，请等待结束。")
  }
  const run = async (binary, args, options = {}) => {
    if (closed) throw new Error("OpenCLI插件已停用。")
    options = {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, lifecycle.signal])
        : lifecycle.signal,
    }
    options.signal?.throwIfAborted()
    const child = managedProcess(binary, args, {
      cwd: options.cwd || host.directory,
      env: options.env || process.env,
    })
    clients.add(child)
    void child.done.then(
      () => clients.delete(child),
      () => clients.delete(child)
    )
    const abort = () => child.stop()
    options.signal?.addEventListener("abort", abort, { once: true })
    try {
      await child.ready
      const result = await bounded(
        child.done,
        options.timeoutMs || 120000,
        (options.label || "OpenCLI操作") + "超时，结果需要重新检查。"
      )
      options.signal?.throwIfAborted()
      return result
    } catch (error) {
      child.stop()
      const result = await bounded(child.done, 10000, "所属进程退出未确认。")
      if (!child.pid && result.stderr.trim()) {
        const diagnostic = failure(result)
        throw new Error(`${error.message} ${diagnostic.message}`, {
          cause: error,
        })
      }
      throw error
    } finally {
      options.signal?.removeEventListener("abort", abort)
    }
  }
  const software = softwareService(run)
  const runnable = (info) => {
    if (info.issue?.includes("兼容引用")) throw new Error(info.issue)
    if (!info.usable) throw new Error(info.issue || "请先安装官方全局OpenCLI。")
  }
  const cli = async (info, args, options = {}) => {
    runnable(info)
    const result = await run(info.nodePath, [info.cliPath, ...args], options)
    if (result.code !== 0) throw failure(result)
    return result
  }
  const modern = async (info, signal) => {
    const signature = info.path + ":" + info.version
    if (capabilities?.signature !== signature) {
      const root = await cli(info, ["--help"], { signal, timeoutMs: 15000 })
      const browser = await cli(info, ["browser", "--help"], {
        signal,
        timeoutMs: 15000,
      })
      const supported =
        /^[ \t]+--profile[ \t]+<[^>\r\n]+>/m.test(root.stdout) &&
        /^[ \t]+--session[ \t]+<[^>\r\n]+>/m.test(browser.stdout)
      capabilities = {
        signature,
        supported,
        issue: supported
          ? ""
          : "当前OpenCLI未提供所需的--session与--profile接口，请升级到最新稳定版。",
      }
    }
    if (!capabilities.supported) throw new Error(capabilities.issue)
  }
  const read = async (signal, fresh = false) => {
    const info = await software.detect(signal, fresh),
      live = await status()
    const unknown = !live && (await occupied())
    let aliasIssue = ""
    const names = await aliases().catch((error) => {
      aliasIssue = error.message
      return {}
    })
    const profiles = (Array.isArray(live?.profiles) ? live.profiles : []).map(
      (profile) => ({
        ...profile,
        aliases: Object.entries(names)
          .filter(([, context]) => context === profile.contextId)
          .map(([alias]) => alias),
      })
    )
    if (!management)
      business = `官方全局OpenCLI ${info.version || (info.state === "not-installed" ? "未安装" : "安装未确认")}；${live ? "后台运行中" : unknown ? "端口占用未确认" : "后台已停止"}；Browser Bridge${live?.extensionConnected || profiles.length ? "已连接" : "未连接"}。`
    return {
      installation: software.summary(info),
      daemon: {
        state: live ? "running" : unknown ? "unknown" : "stopped",
        pid: live?.pid || null,
        version: live?.daemonVersion || null,
        owned: !!live && live.pid === daemon?.pid && !daemon.settled,
      },
      bridge: {
        connected: !!live?.extensionConnected || profiles.length > 0,
        profileRequired: !!live?.profileRequired,
        profiles,
      },
      operation: job ? { ...job } : null,
      browserSupport:
        capabilities &&
        capabilities.signature === info.path + ":" + info.version
          ? { supported: capabilities.supported, issue: capabilities.issue }
          : null,
      version: info.version,
      status: live,
      issue:
        info.issue ||
        aliasIssue ||
        (unknown
          ? "19825由无法识别的程序占用，未启动或停止它。"
          : live && !live.extensionConnected && profiles.length === 0
            ? "后台已运行，Browser Bridge尚未连接。"
            : management
              ? "官方OpenCLI管理中：" + job.phase
              : business),
    }
  }
  const ensure = async (info, explicit = false) => {
    if (closed) throw new Error("OpenCLI插件已停用。")
    runnable(info)
    const live = await status()
    if (live) return live
    if (await occupied())
      throw new Error("19825由无法识别的程序占用，未替换或停止它。")
    if (starting) return starting
    starting = (async () => {
      if (!info.daemonPath)
        throw new Error("当前官方包缺少可用后台入口，请修复或升级安装。")
      const child = managedProcess(
        info.nodePath,
        [info.daemonPath],
        { cwd: host.directory, env: process.env },
        { output: "tail" }
      )
      daemon = child
      explicitDaemonPid = undefined
      try {
        await child.ready
        const deadline = Date.now() + 6000
        while (Date.now() < deadline && !child.settled && !closed) {
          const current = await status()
          if (current) {
            if (
              current.pid !== child.pid ||
              current.daemonVersion !== info.version
            )
              throw new Error("实际后台与本次官方程序不一致，未接管其他进程。")
            if (explicit) explicitDaemonPid = current.pid
            return current
          }
          await pause(100)
        }
        throw new Error("官方OpenCLI后台未能实际启动。")
      } catch (error) {
        child.stop()
        await bounded(child.done, 10000, "自身后台回收未确认。")
        throw error
      }
    })().finally(() => {
      starting = undefined
    })
    return starting
  }
  const stop = async (info, expected, signal, expectedVersion) => {
    const reportUnreleased = () => {
      if (used.size)
        throw new Error(
          `后台已停止；${used.size}个会话释放未确认。原归属保留，请恢复原Browser Bridge连接，主动启动本插件后台后再停止，以重试释放。`
        )
    }
    const live = await status()
    if (!live) {
      if (await occupied())
        throw new Error("19825由无法识别的程序占用，未停止它。")
      reportUnreleased()
      return
    }
    if (expected !== undefined && live.pid !== expected)
      throw new Error("后台已变化，请重新读取后操作。")
    if (expectedVersion !== undefined && live.daemonVersion !== expectedVersion)
      throw new Error("后台版本已变化，请重新读取后操作。")
    const releaseDeadline = Date.now() + 8000
    for (const [session, resource] of used) {
      signal?.throwIfAborted()
      if (Date.now() >= releaseDeadline) break
      try {
        const current = await status(
          resource.profile,
          Math.min(1000, releaseDeadline - Date.now())
        )
        const retryOwnSession =
          confirmedStops.has(resource.pid) &&
          explicitDaemonPid === live.pid &&
          daemon?.pid === live.pid &&
          !daemon.settled
        if (
          !current?.extensionConnected ||
          current.profileRequired ||
          current.profileDisconnected ||
          current.pid !== live.pid ||
          (resource.pid !== live.pid && !retryOwnSession) ||
          current.daemonVersion !== live.daemonVersion ||
          current.contextId !== resource.profile
        )
          throw new Error("原Browser Bridge连接不可用，会话释放未确认。")
        const commandId = "cmd_moon_release_" + randomUUID()
        const response = await fetch("http://127.0.0.1:19825/command", {
          method: "POST",
          headers: { "X-OpenCLI": "1", "Content-Type": "application/json" },
          redirect: "error",
          body: JSON.stringify({
            id: commandId,
            action: "close-window",
            session,
            surface: "browser",
            contextId: resource.profile,
          }),
          signal: AbortSignal.any([
            lifecycle.signal,
            ...(signal ? [signal] : []),
            AbortSignal.timeout(
              Math.max(1, Math.min(3000, releaseDeadline - Date.now()))
            ),
          ]),
        })
        const result = await response.json()
        if (!response.ok || result.ok !== true || result.id !== commandId)
          throw new Error("官方会话释放回执未确认。")
        used.delete(session)
        if (![...used.values()].some((value) => value.pid === resource.pid))
          confirmedStops.delete(resource.pid)
      } catch {
        business =
          "会话释放未确认，原归属保留；请恢复Browser Bridge连接后重试停止。"
      }
    }
    signal?.throwIfAborted()
    const beforeStop = await status()
    if (!beforeStop) {
      if (await occupied()) throw new Error("后台当前无法识别，未继续停止它。")
      if ([...used.values()].some((value) => value.pid === live.pid))
        confirmedStops.add(live.pid)
      reportUnreleased()
      return
    }
    if (
      beforeStop.pid !== live.pid ||
      beforeStop.daemonVersion !== live.daemonVersion
    )
      throw new Error("会话释放期间后台已变化，未停止另一后台，请重新读取。")
    await cli(info, ["daemon", "stop"], { signal, timeoutMs: 15000 })
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const current = await status()
      if (!current && !(await occupied())) {
        if (daemon?.pid === live.pid)
          await bounded(daemon.done, 3000, "自身后台保护器退出未确认。")
        if ([...used.values()].some((value) => value.pid === live.pid))
          confirmedStops.add(live.pid)
        reportUnreleased()
        return
      }
      if (current && current.pid !== live.pid)
        throw new Error("原后台退出后另一后台已启动，未继续停止它。")
      await pause(150)
    }
    throw new Error("停止请求已发送，但实际后台退出尚未确认。")
  }
  const begin = (action, input, signal) => {
    available()
    signal?.throwIfAborted()
    control = new AbortController()
    const controller = control
    const timer = setTimeout(() => controller.abort(), 330000)
    job = {
      id: randomUUID(),
      action,
      state: "running",
      phase: "读取安装和后台",
      startedAt: new Date().toISOString(),
      endedAt: null,
      beforeVersion: null,
      targetVersion: null,
      error: "",
    }
    const current = job
    management = Promise.resolve()
      .then(async () => {
        const info = await software.detect(controller.signal, true)
        current.beforeVersion = info.version
        if (info.issue?.includes("兼容引用")) throw new Error(info.issue)
        if (action === "install" && info.usable) {
          current.phase = "已检测到现有官方全局安装"
          return
        }
        if (action === "install" && info.state === "installed")
          throw new Error(
            info.issue || "已存在官方全局安装，请使用升级并核对实际结果。"
          )
        current.phase = "等待本插件已接受的操作结束"
        await bounded(
          Promise.allSettled([...tools]),
          120000,
          "已有OpenCLI调用尚未结束，请结束后重试。"
        )
        controller.signal.throwIfAborted()
        const actualInfo = await software.detect(controller.signal, true)
        if (
          actualInfo.path !== info.path ||
          actualInfo.version !== info.version
        )
          throw new Error("官方安装在等待期间已变化，请重新读取后操作。")
        if (["install", "upgrade"].includes(action)) {
          current.phase = "查询官方目标版本"
          current.targetVersion = await software.latest(info, controller.signal)
        }
        if (["upgrade", "uninstall"].includes(action)) {
          if (info.state !== "installed")
            throw new Error("未检测到可管理的官方全局安装。")
          const live = await status()
          if (
            live &&
            (input.expectedDaemonPid !== live.pid ||
              input.expectedDaemonVersion !== live.daemonVersion)
          )
            throw new Error(
              "此操作会停止全局后台并影响其他使用者，请重新读取当前后台后操作。"
            )
          current.phase = "释放本插件会话并停止全局后台（影响所有使用者）"
          await stop(
            info,
            live?.pid || 0,
            controller.signal,
            live?.daemonVersion
          )
        }
        if (["install", "upgrade", "uninstall"].includes(action)) {
          if ((await status()) || (await occupied()))
            throw new Error(
              "全局后台目前运行或端口占用，请重新读取并处理后台；尚未变更全局包。"
            )
          current.phase =
            action === "uninstall"
              ? "卸载官方包，保留用户配置"
              : "安装官方发布版本"
          const installed = await software.mutate(
            action,
            info,
            current.targetVersion,
            controller.signal
          )
          if (
            action === "uninstall"
              ? installed.state !== "not-installed"
              : !installed.usable || installed.version !== current.targetVersion
          )
            throw new Error("实际安装结果与目标不一致，请重新读取。")
          capabilities = undefined
          current.phase =
            action === "uninstall"
              ? "已卸载，用户配置保留"
              : "已核对安装版本；后台保持当前停止状态"
        } else if (action === "start") {
          current.phase = "启动或复用官方后台"
          const live = await ensure(info, true)
          current.phase = live.extensionConnected
            ? "后台运行，Browser Bridge已连接"
            : "后台运行，等待Browser Bridge连接"
        } else if (action === "stop") {
          current.phase = "释放本插件会话并等待实际后台退出"
          await stop(
            info,
            input.expectedDaemonPid || 0,
            controller.signal,
            input.expectedDaemonVersion
          )
          current.phase = "后台已确认退出"
        }
      })
      .then(() => {
        current.state = "succeeded"
        business = current.phase
      })
      .catch((error) => {
        current.state = controller.signal.aborted ? "unknown" : "failed"
        current.error = controller.signal.aborted
          ? "管理操作已中断，请重新检查实际安装和后台；未自动重试。"
          : error.message
        if (
          !controller.signal.aborted &&
          error.message.startsWith("后台已停止；")
        ) {
          current.phase = error.message.split("。")[0]
          if (["upgrade", "uninstall"].includes(action))
            current.error += `本次${action === "upgrade" ? "升级" : "卸载"}尚未变更官方包，以保留会话释放渠道。`
        }
        business = current.error
      })
      .finally(() => {
        clearTimeout(timer)
        current.endedAt = new Date().toISOString()
        software.invalidate()
        management = undefined
        control = undefined
      })
    return { operation: { ...current } }
  }
  const profileFor = async () => {
    const configured = host.configuration.profile?.trim() || ""
    if (!configured) return ""
    return (await aliases())[configured] || configured
  }
  const ready = async (context, signal, external = false) => {
    available()
    const info = await software.detect(signal)
    await modern(info, signal)
    const live = await ensure(info)
    if (live.daemonVersion !== info.version)
      throw new Error(
        "已运行后台版本与全局安装不同，请从插件设置停止并启动；未自动替换。"
      )
    const profile =
      (await profileFor()) ||
      live.contextId ||
      (live.profiles?.length === 1 ? live.profiles[0].contextId : "")
    const current = await status(profile)
    if (
      !current?.extensionConnected ||
      !profile ||
      current.profileRequired ||
      current.profileDisconnected
    )
      throw new Error(
        current?.profileRequired
          ? "存在多个Browser Bridge连接，请选择实际连接。"
          : "所选Browser Bridge未连接，请恢复连接。"
      )
    if (current.pid !== live.pid || current.contextId !== profile)
      throw new Error("实际后台或连接已变化，请重新读取。")
    return { info, current, profile, session: external ? "" : taskFor(context) }
  }
  const tracked = (action) => {
    const pending = Promise.resolve().then(action)
    tools.add(pending)
    void pending.then(
      () => tools.delete(pending),
      () => tools.delete(pending)
    )
    return pending
  }
  const execute = (args, context, signal, external = false) =>
    tracked(async () => {
      available()
      const pure =
        args.length === 1 &&
        ["--help", "-h", "--version", "-V"].includes(args[0])
      if (args[0] === "--" || (args[0]?.startsWith("-") && !pure))
        throw new Error("请从实际OpenCLI命令开始。")
      if (
        ["daemon", "profile", "install", "update", "uninstall"].includes(
          args[0]
        )
      )
        throw new Error("全局安装和后台管理请从插件详情操作。")
      const separator = args.indexOf("--")
      const parsed = separator < 0 ? args : args.slice(0, separator)
      if (
        parsed.some((value) => /^--profile(?:=|$)/.test(value)) ||
        (!external && parsed.some((value) => /^--session(?:=|$)/.test(value)))
      )
        throw new Error("浏览器环境与命名会话由Moon按当前会话提供。")
      const discovery =
        pure ||
        parsed.includes("--help") ||
        parsed.includes("-h") ||
        ["list", "doctor"].includes(args[0])
      const browser = args[0] === "browser" && !discovery
      const state = browser
        ? await ready(context, signal, external)
        : {
            info: await software.detect(signal),
            profile: await profileFor(),
            session: external ? "" : taskFor(context),
          }
      let parameters = args
      let registered
      if (browser && !external) {
        registered = used.get(state.session)
        used.set(state.session, {
          profile: state.profile,
          pid: state.current.pid,
        })
        parameters = [
          "browser",
          ...parsed.slice(1),
          "--session",
          state.session,
          ...(separator < 0 ? [] : args.slice(separator)),
        ]
      }
      // External argv is already native. Only Moon-created Pi sessions may
      // enter `used`; stopping the plugin must not close external sessions.
      const command = browser ? openCliBrowserCommand(parsed) : ""
      let result
      try {
        result = await cli(
          state.info,
          [
            ...(state.profile ? ["--profile", state.profile] : []),
            ...parameters,
          ],
          {
            signal,
            env: {
              ...process.env,
              ...(state.profile ? { OPENCLI_PROFILE: state.profile } : {}),
              ...(host.configuration.background
                ? { OPENCLI_WINDOW: "background" }
                : {}),
            },
          }
        )
      } catch (error) {
        // 命令失败时回滚本次登记：不留指向从未创建窗口的僵尸会话。
        if (registered === undefined) used.delete(state.session)
        else used.set(state.session, registered)
        throw error
      }
      let data
      try {
        data = JSON.parse(result.stdout.trim())
      } catch {
        /* Preserve official text output. */
      }
      return {
        text: result.stdout.trim(),
        data: data ?? null,
        profile: state.profile,
        session: state.session,
        capturedAt: new Date().toISOString(),
        screenshot: command === "screenshot",
      }
    })
  const operation = (name, action) => ({
    ...openCliOperations[name],
    execute: async (...args) => ({ value: await action(...args) }),
  })
  return {
    execute,
    sharedTools: [
      {
        name: "run",
        shareable: true,
        description:
          "运行官方 OpenCLI 原生 argv。可读取、下载，也可点击、填表、执行脚本、打开或关闭网站页面，具有写入影响；客户端自行审批。浏览器命令使用 browser <command> --session <name>，保留原生 --tab；用具体命令 --help 核对参数。外部调用自行选择原生 session，Moon 不注入、不创建业务上下文、不在断连或停用时关闭外部页面。profile 沿用插件配置。全局安装、后台和连接管理在 Moon 插件详情。",
        inputSchema: openCliArguments,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
        summarize: summarizeOpenCli,
        execute: async (input, _context, signal) =>
          toolResult(await execute(input.arguments, undefined, signal, true)),
      },
    ],
    operations: {
      ...Object.fromEntries(
        openCliManagement.map((name) => [
          name,
          operation(name, (input, _context, signal) =>
            begin(name, input, signal)
          ),
        ])
      ),
      status: operation("status", (_input, _context, signal) => read(signal)),
      connect: operation("connect", (_input, _context, signal) =>
        tracked(async () => {
          available()
          const info = await software.detect(signal)
          signal?.throwIfAborted()
          await ensure(info)
          return read(signal)
        })
      ),
    },
    status: () => (management ? "官方OpenCLI管理中：" + job.phase : business),
    quiesce() {
      frozen = true
    },
    resume() {
      if (!closed) frozen = false
    },
    async close() {
      closed = true
      frozen = true
      control?.abort()
      lifecycle.abort()
      for (const child of clients) child.stop()
      const failures = []
      const deadline = Date.now() + 12000
      const remaining = (reserve = 3000) =>
        Math.max(1, deadline - Date.now() - reserve)
      try {
        const clientsResult = await bounded(
          Promise.allSettled([...clients].map((child) => child.done)),
          remaining(),
          "所属客户端/npm进程回收未确认。"
        )
        if (clientsResult.some((result) => result.status === "rejected"))
          throw new Error("所属客户端/npm进程回收失败。")
        if (management)
          await bounded(management, remaining(), "管理操作结束未确认。")
        if (starting)
          await bounded(
            starting.catch(() => {}),
            remaining(),
            "后台启动收尾未确认。"
          )
        for (const [session, resource] of used) {
          if (remaining() <= 1) {
            failures.push(new Error("自身会话释放超时，原归属保留。"))
            break
          }
          const live = await status(
            resource.profile,
            Math.min(500, remaining())
          )
          if (!live?.extensionConnected || live.pid !== resource.pid) {
            failures.push(new Error("原连接不可用，自身会话释放未确认。"))
            continue
          }
          const response = await fetch("http://127.0.0.1:19825/command", {
            method: "POST",
            headers: { "X-OpenCLI": "1", "Content-Type": "application/json" },
            body: JSON.stringify({
              id: "cmd_moon_close_" + randomUUID(),
              action: "close-window",
              session,
              surface: "browser",
              contextId: resource.profile,
            }),
            signal: AbortSignal.timeout(Math.min(3000, remaining())),
            redirect: "error",
          })
          if (!response.ok || !(await response.json()).ok)
            failures.push(new Error("自身会话释放未确认；用户标签不关闭。"))
          else {
            used.delete(session)
          }
        }
      } catch (error) {
        failures.push(error)
      } finally {
        if (daemon && !daemon.settled) {
          daemon.stop()
          try {
            await bounded(
              daemon.done,
              remaining(0),
              "自身后台保护器回收未确认。"
            )
          } catch (error) {
            failures.push(error)
          }
        }
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          "OpenCLI所属资源释放未确认，原归属保留。"
        )
      tasks.clear()
      used.clear()
    },
  }
}
