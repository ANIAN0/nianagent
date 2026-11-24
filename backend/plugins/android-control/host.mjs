import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { stripVTControlCharacters } from "node:util"
import { createAdbClient } from "./adb.mjs"
import { androidControlOperations } from "./contract.mjs"
import { createScrcpyControlPool } from "./scrcpy-control.mjs"
import { softwareService } from "./software.mjs"
import {
  actInputSchema,
  formatScreenshotToolResult,
  formatTextToolResult,
  observeInputSchema,
  summarizeAndroidControl,
  validateAndroidPolicy,
} from "./tool-result.mjs"

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_OPERATION_LOGS = 80
const SPINNER_ONLY_RE = /^[\s\\|/\-⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+$/

function killProcessTree(child) {
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  if (process.platform === "win32" && child.pid) {
    try {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/t", "/f"],
        {
          windowsHide: true,
          stdio: "ignore",
        }
      )
      killer.unref()
    } catch {
      /* ignore */
    }
  }
}

function appendOperationLogs(logs, chunkText) {
  const cleaned = stripVTControlCharacters(String(chunkText || ""))
  if (!cleaned) return false
  const next = logs.slice()
  let changed = false
  const segments = cleaned.split("\n")
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    const hasCR = seg.includes("\r")
    const parts = seg.split("\r").map((p) => p.trimEnd())
    const text =
      parts.reduceRight((acc, cur) => acc || (cur.trim() ? cur : ""), "") || ""
    const trimmed = text.trim()
    if (!trimmed || SPINNER_ONLY_RE.test(trimmed)) continue
    const isProgress =
      hasCR ||
      /[█▓▒░■]/.test(trimmed) ||
      /\b\d+(?:\.\d+)?\s*(?:KB|MB|GB|B)\s*\/\s*\d+/i.test(trimmed)
    if (
      isProgress &&
      next.length > 0 &&
      (/[█▓▒░■]/.test(next[next.length - 1]) ||
        /\b\d+(?:\.\d+)?\s*(?:KB|MB|GB|B)\s*\/\s*\d+/i.test(
          next[next.length - 1]
        ))
    ) {
      if (next[next.length - 1] !== trimmed) {
        next[next.length - 1] = trimmed
        changed = true
      }
    } else if (next[next.length - 1] !== trimmed) {
      next.push(trimmed)
      changed = true
    }
  }
  if (!changed) return null
  return next.slice(-MAX_OPERATION_LOGS)
}

function runChildProcess(binary, args, options = {}) {
  const {
    cwd,
    env = process.env,
    signal,
    timeoutMs = 30000,
    label = "android-control",
    binaryOutput = false,
    onOutput,
  } = options

  signal?.throwIfAborted()

  const useShell =
    process.platform === "win32" &&
    (binary.toLowerCase().endsWith(".cmd") ||
      binary.toLowerCase().endsWith(".bat"))

  const child = spawn(binary, args, {
    cwd,
    env,
    windowsHide: true,
    shell: useShell,
    stdio: ["ignore", "pipe", "pipe"],
  })

  return new Promise((resolve, reject) => {
    const stdoutChunks = []
    let stdoutLen = 0
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
      killProcessTree(child)
      finish(reject, signal.reason || new Error(`${label} 已取消。`))
    }

    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child)
      finish(reject, new Error(`${label} 执行超时（${timeoutMs}ms）。`))
    }, timeoutMs)

    signal?.addEventListener("abort", onAbort, { once: true })

    child.stdout.on("data", (chunk) => {
      if (stdoutLen < MAX_OUTPUT_BYTES) {
        stdoutChunks.push(chunk)
        stdoutLen += chunk.length
      }
      if (!binaryOutput && onOutput) {
        onOutput(chunk.toString("utf8"), "stdout")
      }
    })

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8")
      stderr = (stderr + text).slice(-32768)
      if (onOutput) {
        onOutput(text, "stderr")
      }
    })

    child.once("error", (error) => {
      finish(reject, new Error(`${label} 启动失败：${error.message}`))
    })

    child.once("close", (code) => {
      if (timedOut) return
      const buf = Buffer.concat(stdoutChunks)
      finish(resolve, {
        code: code ?? 1,
        stdout: binaryOutput ? buf : buf.toString("utf8"),
        stderr,
      })
    })
  })
}

function normalizeConfig(raw = {}) {
  const maxSize = Number(raw.mirrorMaxSize)
  return {
    scrcpyPath: typeof raw.scrcpyPath === "string" ? raw.scrcpyPath.trim() : "",
    defaultSerial:
      typeof raw.defaultSerial === "string" ? raw.defaultSerial.trim() : "",
    readOnly: Boolean(raw.readOnly),
    allowClipboard: Boolean(raw.allowClipboard),
    allowAppLifecycle:
      raw.allowAppLifecycle === undefined
        ? true
        : Boolean(raw.allowAppLifecycle),
    allowApkInstall: Boolean(raw.allowApkInstall),
    allowFileTransfer: Boolean(raw.allowFileTransfer),
    mirrorMaxSize: Number.isFinite(maxSize) && maxSize >= 0 ? maxSize : 1080,
    mirrorScreenOff: Boolean(raw.mirrorScreenOff),
    mirrorStayAwake:
      raw.mirrorStayAwake === undefined ? true : Boolean(raw.mirrorStayAwake),
    mirrorReadOnly: Boolean(raw.mirrorReadOnly),
  }
}

export async function activate(host) {
  let closed = false
  let frozen = false
  let management = null
  let managementAbort = null
  let job = null
  let config = normalizeConfig(host.configuration)
  const lifecycle = new AbortController()
  const mirrorProcesses = new Map()
  const uiRefsBySerial = new Map()
  let lastInstallation = null

  const ensureAvailable = () => {
    if (closed) throw new Error("安卓控制插件已停用。")
    if (frozen) throw new Error("Moon 正在维护，安卓控制暂不接受新请求。")
  }

  const run = (binary, args, options = {}) => {
    if (closed) throw new Error("安卓控制插件已停用。")
    const signal = options.signal
      ? AbortSignal.any([options.signal, lifecycle.signal])
      : lifecycle.signal
    return runChildProcess(binary, args, {
      cwd: options.cwd || host.directory,
      env: process.env,
      signal,
      timeoutMs: options.timeoutMs ?? 20000,
      label: options.label,
      binaryOutput: false,
      onOutput: options.onOutput,
    })
  }

  const runBinary = (binary, args, options = {}) => {
    if (closed) throw new Error("安卓控制插件已停用。")
    const signal = options.signal
      ? AbortSignal.any([options.signal, lifecycle.signal])
      : lifecycle.signal
    return runChildProcess(binary, args, {
      cwd: options.cwd || host.directory,
      env: process.env,
      signal,
      timeoutMs: options.timeoutMs ?? 20000,
      label: options.label,
      binaryOutput: true,
    })
  }

  const software = softwareService(run)

  const getInstallation = async (_signal, force = false) => {
    const info = await software.read({ customPath: config.scrcpyPath, force })
    lastInstallation = info
    return info
  }

  const adb = createAdbClient({
    run,
    runBinary,
    getAdbPath: () => lastInstallation?.adbPath || null,
  })

  const controlPool = createScrcpyControlPool({
    adb,
    getInstallation,
    // Owned ADB resources must remain removable after the plugin stops
    // accepting requests and its request lifecycle has been aborted.
    runAdb: (binary, args, options) =>
      runChildProcess(binary, args, { ...options, label: "scrcpy ADB" }),
  })

  const attachMirrorAndDefault = (devices) => {
    const online = devices.filter((d) => d.state === "device")
    const effectiveDefault =
      config.defaultSerial &&
      online.some((d) => d.serial === config.defaultSerial)
        ? config.defaultSerial
        : online.length === 1
          ? online[0].serial
          : ""
    return devices.map((d) => {
      const proc = mirrorProcesses.get(d.serial)
      return {
        ...d,
        isDefault: Boolean(effectiveDefault && d.serial === effectiveDefault),
        mirroring: Boolean(proc && !proc.killed),
        mirrorPid: proc && !proc.killed ? (proc.pid ?? null) : null,
      }
    })
  }

  const listEnrichedDevices = async (signal) => {
    const info = await getInstallation(signal)
    if (!info.usable) return []
    const raw = await adb.listDevices(signal)
    return attachMirrorAndDefault(raw)
  }

  const resolveTargetSerial = async (requestedSerial, signal) => {
    await getInstallation(signal)
    const devices = await adb.listDevices(signal)
    const online = devices.filter((d) => d.state === "device")
    if (requestedSerial) {
      const found = devices.find((d) => d.serial === requestedSerial)
      if (!found) throw new Error(`未找到设备：${requestedSerial}`)
      if (found.state !== "device") {
        throw new Error(
          found.issue ||
            `设备 ${requestedSerial} 当前不可用（${found.state}）。`
        )
      }
      return found.serial
    }
    if (config.defaultSerial) {
      const def = online.find((d) => d.serial === config.defaultSerial)
      if (def) return def.serial
    }
    if (online.length === 1) return online[0].serial
    if (online.length === 0) {
      const unauth = devices.find((d) => d.state === "unauthorized")
      if (unauth) {
        throw new Error(
          unauth.issue || "设备未授权 USB 调试，请在手机上确认授权。"
        )
      }
      throw new Error("当前没有可用的在线安卓设备，请连接设备或检查 USB 调试。")
    }
    throw new Error(
      `当前连接了 ${online.length} 台设备，请在安卓控制插件页点击「设为默认」或在参数中指定 serial。`
    )
  }

  const readStatus = async (signal, force = false) => {
    const installation = await getInstallation(signal, force)
    let devices = []
    let issue = installation.issue || ""
    if (installation.usable) {
      try {
        devices = attachMirrorAndDefault(await adb.listDevices(signal))
      } catch (error) {
        issue = error instanceof Error ? error.message : String(error)
      }
    }
    return {
      installation,
      devices,
      defaultSerial: config.defaultSerial,
      operation: job,
      issue,
    }
  }

  const emitStatus = async () => {
    try {
      const value = await readStatus(lifecycle.signal)
      host.emit?.("status-changed", value)
    } catch {
      /* ignore */
    }
  }

  const startManagement = async (action) => {
    ensureAvailable()
    if (management) return { operation: job }
    const before = await getInstallation(lifecycle.signal, true).catch(
      () => null
    )
    const controller = new AbortController()
    managementAbort = controller
    job = {
      id: randomUUID(),
      action,
      state: "running",
      phase:
        action === "install"
          ? "正在通过系统包管理器安装 scrcpy..."
          : action === "upgrade"
            ? "正在升级 scrcpy..."
            : "正在卸载 scrcpy...",
      startedAt: new Date().toISOString(),
      endedAt: null,
      beforeVersion: before?.scrcpyVersion ?? null,
      targetVersion: null,
      error: "",
      logs: [],
    }
    host.emit?.("operation-changed", { operation: job })

    let emitTimer = null
    const scheduleLogEmit = () => {
      if (emitTimer) return
      emitTimer = setTimeout(() => {
        emitTimer = null
        if (job) host.emit?.("operation-changed", { operation: job })
      }, 200)
    }

    management = (async () => {
      try {
        const nextInfo = await software.manage(action, {
          customPath: config.scrcpyPath,
          signal: controller.signal,
          onOutput: (chunk) => {
            if (!job) return
            const updated = appendOperationLogs(job.logs || [], chunk)
            if (updated) {
              job = { ...job, logs: updated }
              scheduleLogEmit()
            }
          },
        })
        lastInstallation = nextInfo
        job = {
          ...job,
          state: "succeeded",
          phase:
            action === "uninstall"
              ? "已卸载"
              : `已完成（${nextInfo.scrcpyVersion || "已就绪"}）`,
          endedAt: new Date().toISOString(),
          targetVersion: nextInfo.scrcpyVersion ?? null,
          error: "",
        }
      } catch (error) {
        if (controller.signal.aborted) {
          job = {
            ...job,
            state: "cancelled",
            phase: "已取消",
            endedAt: new Date().toISOString(),
            error: "",
          }
        } else {
          job = {
            ...job,
            state: "failed",
            phase: "操作未完成",
            endedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          }
        }
      } finally {
        if (emitTimer) {
          clearTimeout(emitTimer)
          emitTimer = null
        }
        management = null
        if (managementAbort === controller) {
          managementAbort = null
        }
        host.emit?.("operation-changed", { operation: job })
        await emitStatus()
      }
    })()

    return { operation: job }
  }

  const cancelManagement = () => {
    if (!management || !managementAbort || !job || job.state !== "running") {
      return { cancelled: false, operation: job }
    }
    job = {
      ...job,
      phase: "正在取消...",
      logs:
        appendOperationLogs(job.logs || [], "用户请求取消，正在终止进程...") ||
        job.logs ||
        [],
    }
    host.emit?.("operation-changed", { operation: job })
    managementAbort.abort(new Error("用户已取消操作。"))
    return { cancelled: true, operation: job }
  }

  const startMirror = async (input = {}, signal) => {
    const info = await getInstallation(signal)
    if (!info.canMirror || !info.scrcpyPath) {
      throw new Error("未检测到可用的 scrcpy，无法拉起原生投屏窗口。")
    }
    const serial = await resolveTargetSerial(input.serial, signal)
    const existing = mirrorProcesses.get(serial)
    if (existing && !existing.killed) {
      return {
        serial,
        pid: existing.pid ?? 0,
        mode: input.virtualDisplay ? "virtual-display" : "mirror",
      }
    }

    const args = ["-s", serial, "--window-title", `Moon · ${serial}`]
    if (config.mirrorMaxSize > 0) {
      args.push("--max-size", String(config.mirrorMaxSize))
    }
    if (config.mirrorScreenOff) args.push("--turn-screen-off")
    if (config.mirrorStayAwake) args.push("--stay-awake")
    if (config.readOnly || config.mirrorReadOnly) args.push("--no-control")
    if (input.virtualDisplay) {
      args.push(`--new-display=${String(input.virtualDisplay).trim()}`)
    }
    if (input.startApp) {
      args.push(`--start-app=${String(input.startApp).trim()}`)
    }

    const child = spawn(info.scrcpyPath, args, {
      cwd: host.directory,
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    })

    let stderr = ""
    child.stderr?.on("data", (d) => {
      stderr = (stderr + d.toString("utf8")).slice(-2048)
    })

    mirrorProcesses.set(serial, child)
    host.emit?.("mirror-changed", {
      serial,
      mirroring: true,
      pid: child.pid ?? null,
    })

    child.once("close", (code) => {
      if (mirrorProcesses.get(serial) === child) {
        mirrorProcesses.delete(serial)
        host.emit?.("mirror-changed", {
          serial,
          mirroring: false,
          pid: null,
          code,
          error: code && code !== 0 ? stderr.trim() : "",
        })
      }
    })

    // Brief wait to surface immediate startup error (e.g. device disconnected)
    await new Promise((r) => setTimeout(r, 350))
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(
        stderr.trim() || `scrcpy 启动失败（退出码 ${child.exitCode}）`
      )
    }

    return {
      serial,
      pid: child.pid ?? 0,
      mode: input.virtualDisplay ? "virtual-display" : "mirror",
    }
  }

  const stopMirror = async (serial) => {
    const target = serial || config.defaultSerial
    const proc = target ? mirrorProcesses.get(target) : null
    if (!proc) return { ok: true }
    mirrorProcesses.delete(target)
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
    host.emit?.("mirror-changed", {
      serial: target,
      mirroring: false,
      pid: null,
    })
    return { ok: true }
  }

  const resolveCoords = (serial, input) => {
    if (input.ref) {
      const refs = uiRefsBySerial.get(serial)
      const hit = refs?.get(String(input.ref).trim())
      if (!hit) {
        throw new Error(
          `未找到控件引用 ${input.ref}，请先调用 android_observe({ action: "ui-tree" }) 刷新控件树。`
        )
      }
      return { x: hit.center[0], y: hit.center[1] }
    }
    if (typeof input.x === "number" && typeof input.y === "number") {
      return { x: input.x, y: input.y }
    }
    throw new Error("请提供有效的控件引用 ref（如 @e3）或像素坐标 x, y。")
  }

  const executeObserve = async (input, _context, signal) => {
    ensureAvailable()
    const { action } = validateAndroidPolicy({ mode: "observe", input, config })

    if (action === "list-devices") {
      const devices = await listEnrichedDevices(signal)
      return formatTextToolResult(
        { devices, defaultSerial: config.defaultSerial },
        { action, count: devices.length }
      )
    }

    const serial = await resolveTargetSerial(input.serial, signal)

    if (action === "device-info") {
      const info = await adb.getDeviceInfo(serial, signal)
      return formatTextToolResult(info, { action, serial })
    }

    if (action === "screenshot") {
      const [info, buffer] = await Promise.all([
        adb.getScreenSize(serial, signal),
        adb.screenshot(serial, signal),
      ])
      return formatScreenshotToolResult(buffer, {
        serial,
        width: info.width,
        height: info.height,
        rotation: info.rotation,
      })
    }

    if (action === "ui-tree") {
      const tree = await adb.dumpUiTree(
        serial,
        { includeNonInteractive: input.includeNonInteractive },
        signal
      )
      uiRefsBySerial.set(serial, tree.refs)
      return formatTextToolResult(
        {
          serial,
          total: tree.total,
          nodes: tree.nodes,
        },
        { action, serial, total: tree.total }
      )
    }

    if (action === "list-apps") {
      const packages = await adb.listApps(
        serial,
        {
          includeSystem: input.includeSystem,
          query: input.query,
        },
        signal
      )
      return formatTextToolResult(
        { serial, count: packages.length, packages },
        { action, serial, count: packages.length }
      )
    }

    throw new Error(`未实现的观察动作：${action}`)
  }

  const executeAct = async (input, _context, signal) => {
    ensureAvailable()
    const { action } = validateAndroidPolicy({ mode: "act", input, config })
    const serial = await resolveTargetSerial(input.serial, signal)

    if (action === "open-mirror") {
      const res = await startMirror(
        {
          serial,
          virtualDisplay: input.virtualDisplay,
          startApp: input.packageName,
        },
        signal
      )
      return formatTextToolResult(
        { ok: true, ...res },
        { action, serial, transport: "scrcpy-window" }
      )
    }

    if (action === "close-mirror") {
      await stopMirror(serial)
      return formatTextToolResult({ ok: true, serial }, { action, serial })
    }

    if (action === "tap") {
      const [coords, screen] = await Promise.all([
        Promise.resolve(resolveCoords(serial, input)),
        adb.getScreenSize(serial, signal),
      ])
      const res = await controlPool.tap(
        serial,
        coords.x,
        coords.y,
        screen,
        signal
      )
      return formatTextToolResult(
        { ok: true, action, serial, x: coords.x, y: coords.y, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "long-press") {
      const [coords, screen] = await Promise.all([
        Promise.resolve(resolveCoords(serial, input)),
        adb.getScreenSize(serial, signal),
      ])
      const res = await controlPool.longPress(
        serial,
        coords.x,
        coords.y,
        input.durationMs,
        screen,
        signal
      )
      return formatTextToolResult(
        { ok: true, action, serial, x: coords.x, y: coords.y, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "swipe") {
      if (
        typeof input.x !== "number" ||
        typeof input.y !== "number" ||
        typeof input.x2 !== "number" ||
        typeof input.y2 !== "number"
      ) {
        throw new Error("swipe 需要提供起点 (x, y) 与终点 (x2, y2) 坐标。")
      }
      const screen = await adb.getScreenSize(serial, signal)
      const res = await controlPool.swipe(
        serial,
        input.x,
        input.y,
        input.x2,
        input.y2,
        input.durationMs,
        screen,
        signal
      )
      return formatTextToolResult(
        { ok: true, action, serial, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "scroll") {
      const screen = await adb.getScreenSize(serial, signal)
      const cx =
        typeof input.x === "number" ? input.x : Math.round(screen.width / 2)
      const cy =
        typeof input.y === "number" ? input.y : Math.round(screen.height / 2)
      const dir = input.direction || "down"
      const amt = Math.max(1, Math.min(16, Number(input.amount) || 4))
      const hScroll = dir === "left" ? amt : dir === "right" ? -amt : 0
      const vScroll = dir === "up" ? amt : dir === "down" ? -amt : 0
      const res = await controlPool.scroll(
        serial,
        cx,
        cy,
        hScroll,
        vScroll,
        screen,
        signal
      )
      return formatTextToolResult(
        { ok: true, action, serial, direction: dir, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "input-text") {
      if (typeof input.text !== "string" || !input.text.length) {
        throw new Error("input-text 需要提供非空的 text 参数。")
      }
      const res = await controlPool.injectText(serial, input.text, signal)
      return formatTextToolResult(
        { ok: true, action, serial, length: input.text.length, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "key") {
      if (!input.key) throw new Error("key 动作需要提供按键名。")
      const res =
        input.key === "back"
          ? await controlPool.backOrScreenOn(serial, signal)
          : await controlPool.key(serial, input.key, signal)
      return formatTextToolResult(
        { ok: true, action, serial, key: input.key, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "wake" || action === "sleep") {
      const res = await controlPool.setDisplayPower(
        serial,
        action === "wake",
        signal
      )
      return formatTextToolResult(
        { ok: true, action, serial, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "expand-notifications") {
      const res = await controlPool.expandNotifications(serial, signal)
      return formatTextToolResult(
        { ok: true, action, serial, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "collapse-panels") {
      const res = await controlPool.collapsePanels(serial, signal)
      return formatTextToolResult(
        { ok: true, action, serial, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "rotate") {
      const res = await controlPool.rotate(serial, signal)
      return formatTextToolResult(
        { ok: true, action, serial, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "launch-app") {
      if (!input.packageName)
        throw new Error("launch-app 需要提供 packageName。")
      const res = await controlPool.startApp(serial, input.packageName, signal)
      return formatTextToolResult(
        { ok: true, action, serial, packageName: input.packageName, ...res },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "stop-app") {
      if (!input.packageName) throw new Error("stop-app 需要提供 packageName。")
      await adb.stopApp(serial, input.packageName, signal)
      return formatTextToolResult(
        {
          ok: true,
          action,
          serial,
          packageName: input.packageName,
          transport: "adb",
        },
        { action, serial, transport: "adb" }
      )
    }

    if (action === "clipboard-get") {
      const res = await controlPool.getClipboard(serial, signal)
      return formatTextToolResult(
        { ok: true, action, serial, text: res.text, transport: res.transport },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "clipboard-set") {
      if (typeof input.text !== "string") {
        throw new Error("clipboard-set 需要提供 text 参数。")
      }
      const res = await controlPool.setClipboard(
        serial,
        input.text,
        Boolean(input.paste),
        signal
      )
      return formatTextToolResult(
        {
          ok: true,
          action,
          serial,
          length: input.text.length,
          transport: res.transport,
        },
        { action, serial, transport: res.transport }
      )
    }

    if (action === "install-apk") {
      if (!input.localPath) throw new Error("install-apk 需要提供 localPath。")
      const out = await adb.installApk(serial, input.localPath, signal)
      return formatTextToolResult(
        { ok: true, action, serial, output: out, transport: "adb" },
        { action, serial, transport: "adb" }
      )
    }

    if (action === "push-file") {
      if (!input.localPath || !input.remotePath) {
        throw new Error("push-file 需要提供 localPath 与 remotePath。")
      }
      await adb.pushFile(serial, input.localPath, input.remotePath, signal)
      return formatTextToolResult(
        {
          ok: true,
          action,
          serial,
          remotePath: input.remotePath,
          transport: "adb",
        },
        { action, serial, transport: "adb" }
      )
    }

    if (action === "pull-file") {
      if (!input.remotePath || !input.localPath) {
        throw new Error("pull-file 需要提供 remotePath 与 localPath。")
      }
      await adb.pullFile(serial, input.remotePath, input.localPath, signal)
      return formatTextToolResult(
        {
          ok: true,
          action,
          serial,
          localPath: input.localPath,
          transport: "adb",
        },
        { action, serial, transport: "adb" }
      )
    }

    throw new Error(`未实现的控制动作：${action}`)
  }

  return {
    operations: Object.fromEntries(
      Object.entries(androidControlOperations).map(([name, meta]) => [
        name,
        {
          ...meta,
          execute: async (input = {}, _context = {}, signal) => {
            ensureAvailable()
            if (name === "status") {
              return { value: await readStatus(signal) }
            }
            if (
              name === "install" ||
              name === "upgrade" ||
              name === "uninstall"
            ) {
              return { value: await startManagement(name) }
            }
            if (name === "cancel-manage") {
              return { value: cancelManagement() }
            }
            if (name === "refresh-devices") {
              const devices = await listEnrichedDevices(signal)
              host.emit?.("devices-changed", { devices })
              return { value: { devices } }
            }
            if (name === "connect-wireless") {
              const res = await adb.connectWireless(input.address, signal)
              const devices = await listEnrichedDevices(signal)
              host.emit?.("devices-changed", { devices })
              return { value: res }
            }
            if (name === "pair-wireless") {
              return {
                value: await adb.pairWireless(
                  input.address,
                  input.pairingCode,
                  signal
                ),
              }
            }
            if (name === "enable-tcpip") {
              const res = await adb.enableTcpip(
                input.serial,
                input.port || 5555,
                signal
              )
              const devices = await listEnrichedDevices(signal)
              host.emit?.("devices-changed", { devices })
              return { value: res }
            }
            if (name === "disconnect-wireless") {
              await controlPool.closeConnection(input.serial)
              const res = await adb.disconnectWireless(input.serial, signal)
              const devices = await listEnrichedDevices(signal)
              host.emit?.("devices-changed", { devices })
              return { value: res }
            }
            if (name === "start-mirror") {
              return { value: await startMirror(input, signal) }
            }
            if (name === "stop-mirror") {
              return { value: await stopMirror(input.serial) }
            }
            if (name === "probe-device") {
              const serial = await resolveTargetSerial(input.serial, signal)
              const [devInfo, tree] = await Promise.all([
                adb.getDeviceInfo(serial, signal),
                adb.dumpUiTree(serial, {}, signal),
              ])
              uiRefsBySerial.set(serial, tree.refs)
              return {
                value: {
                  ok: true,
                  serial,
                  model: devInfo.model,
                  resolution: `${devInfo.screenWidth}x${devInfo.screenHeight}`,
                  uiNodeCount: tree.total,
                  checkedAt: new Date().toISOString(),
                  issue: "",
                },
              }
            }
            throw new Error(`未知操作：${name}`)
          },
        },
      ])
    ),
    sharedTools: [
      {
        name: "android_observe",
        description:
          "只读观察安卓设备：列出设备(list-devices)、读取设备与前台应用信息(device-info)、屏幕截图(screenshot)、解析可交互无障碍控件树(ui-tree，返回 @e1/@e2 引用与坐标)及应用列表(list-apps)。",
        inputSchema: observeInputSchema,
        execute: executeObserve,
        summarize: (input, result, error) =>
          summarizeAndroidControl({
            toolName: "android_observe",
            input,
            result,
            error,
          }),
      },
      {
        name: "android_act",
        description:
          "通过 scrcpy-server 轻量控制通道与 ADB 操作安卓设备：点击(tap，支持 @eN 引用或坐标)、长按(long-press)、滑动(swipe)、滚动(scroll)、输入中文/文本(input-text)、按键(key)、亮/息屏(wake/sleep)、通知栏、启停应用、剪贴板、文件传输以及拉起原生投屏窗口(open-mirror)供人工接管。",
        inputSchema: actInputSchema,
        execute: executeAct,
        summarize: (input, result, error) =>
          summarizeAndroidControl({
            toolName: "android_act",
            input,
            result,
            error,
          }),
      },
    ],
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
      managementAbort?.abort(new Error("插件已停用。"))
      lifecycle.abort()
      for (const proc of mirrorProcesses.values()) {
        try {
          proc.kill()
        } catch {
          /* ignore */
        }
      }
      mirrorProcesses.clear()
      await controlPool.closeAll()
    },
  }
}
