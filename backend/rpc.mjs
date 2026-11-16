import { createDiagnosticQuery } from "./diagnostic-query.mjs"
import { createInterface } from "node:readline"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { prepareNodeStorage } from "./storage-bootstrap.mjs"
import { validateDomains } from "./storage-validation.mjs"
import { DesktopMaintenance } from "./desktop-maintenance.mjs"
import { startRuntime, runtimeVersion } from "./runtime.mjs"
import {
  operationError,
  publicFailure,
  TransportFailure,
} from "./operation-issue.mjs"
import { currentTraceId, withRequestContext } from "./request-context.mjs"
import { transportRecoveryByOperation } from "./contract.mjs"
import { createBoundedJsonlLogger, diagnosticFrames } from "./logger.mjs"
import {
  connectDirectoryHost,
  acceptDirectoryReply,
  closeDirectoryHost,
} from "./native-directory.mjs"

const { directory } = prepareNodeStorage()
// G11：传输层操作终态日志（traceId/operationId/durationMs/outcome/errorId；白名单字段）
const operationLogger = createBoundedJsonlLogger({
  directory: join(directory, "logs"),
  name: "moon-node",
})
// T20-3：诊断窄端口——logs 插件只消费只读查询与状态摘要（读取侧再次按白名单投影），
// 不暴露写入面与文件路径
const operationLog = createDiagnosticQuery(
  join(directory, "logs"),
  operationLogger
)
let service
const pending = new Map()
const requests = new Map()
const maintenance = new DesktopMaintenance(() => service, requests)
// Keep the transport alive even when initialization fails: both native and web
// callers must receive the actual safe configuration error, not a process hint.
let initialized
function ensureInitialized() {
  initialized ??= initializeService().catch((error) => {
    initialized = undefined
    throw error
  })
  return initialized
}
async function initializeService() {
  // Publish the transport before loading Pi's large dependency graph. Tauri's
  // startup handshake must not wait for model libraries or user-data recovery.
  const { MoonServices } = await import("./services.mjs")
  if (closing) throw new Error("Moon 正在退出。")
  const candidate = new MoonServices(directory, {
    dispatchRequest: dispatch,
    operationLog,
    diagnostics: { append: (record) => operationLogger.append(record) },
    // 后端主动通知经 stdout 下发（$notify 无 id），桌面端转 Tauri 事件
    notify: (value) => send(value),
  })
  candidate.conversations.setMaintenanceFrozen(Boolean(maintenance.operationId))
  service = candidate
  try {
    if (closing) throw new Error("Moon 正在退出。")
    return candidate
  } catch (error) {
    await candidate.close()
    if (service === candidate) service = undefined
    throw error
  }
}
const version = await runtimeVersion()
const inFlight = new Set()
let closing = false
async function execute(operation, input, signal) {
  if (operation === "$runtime") return runtime?.info ?? { version }
  if ((await runtimeVersion()) !== version)
    throw operationError(
      "host_version",
      "Moon 服务代码已更新，请重启 Moon 后重新读取。",
      "restart"
    )
  const ready = await ensureInitialized()
  signal?.throwIfAborted()
  if (closing) throw new Error("Moon 正在退出。")
  if (!maintenance.accepts(operation))
    throw operationError(
      "maintenance_busy",
      "Moon 正在维护，请等待完成或重新启动恢复。",
      "restart"
    )
  return ready.dispatch(operation, input, signal)
}
async function dispatch(operation, input, signal) {
  if (closing) throw new Error("Moon 正在退出。")
  if (operation.startsWith("$"))
    throw new Error("内部宿主请求不能由业务入口调用。")
  if (!maintenance.accepts(operation))
    throw operationError(
      "maintenance_busy",
      "Moon 正在维护，请等待完成或重新启动恢复。",
      "restart"
    )
  const id = randomUUID()
  const startedAt = Date.now()
  const traceId = currentTraceId()
  const operationPromise = execute(operation, input, signal)
  requests.set(id, {
    operation,
    sessionId: input?.sessionId,
    done: operationPromise,
  })
  inFlight.add(operationPromise)
  try {
    const result = await operationPromise
    operationLogger.append({
      module: "rpc",
      event: operation,
      level:
        transportRecoveryByOperation[operation] === "reload" ||
        ["pluginCall", "conversationMarkRead"].includes(operation)
          ? "debug"
          : "info",
      traceId,
      operationId: id,
      durationMs: Date.now() - startedAt,
      outcome: "committed",
    })
    return result
  } catch (error) {
    // G20：终态依据领域回执——回执声明 result_unknown 即 unknown（不得按错误类改判）；
    // 其余 MoonOperationError/ContractError 是进入领域前的明确拒绝；
    // 取消与一般失败无法证明领域尚未接受，保持 unknown；
    // 脱敏摘要与用户可见 issue 同源同 errorId（T20-1：publicFailure 对同一失败只规范一次）。
    const cancelled = signal?.aborted || error?.name === "AbortError"
    const sanitized = publicFailure(error, operation, cancelled)
    const receipt = error?.issue
    const outcome = receipt?.outcome
      ? receipt.outcome
      : receipt?.code === "result_unknown"
        ? "unknown"
        : error.name === "MoonOperationError" || error.name === "ContractError"
          ? "rejected"
          : "unknown"
    operationLogger.append({
      module: "rpc",
      event: operation,
      level:
        (operation === "pluginCall" &&
          input.id === "notes-workbench" &&
          error.issue?.module === "workbench") ||
        (cancelled && transportRecoveryByOperation[operation] === "reload")
          ? "debug"
          : sanitized.issue.severity === "info"
            ? "warn"
            : sanitized.issue.severity === "warning"
              ? "warn"
              : "error",
      traceId,
      operationId: id,
      durationMs: Date.now() - startedAt,
      outcome: cancelled ? "unknown" : outcome,
      error: {
        code: sanitized.issue.code,
        errorId: sanitized.issue.errorId ?? "",
        cause: sanitized.issue.summary,
        ...(!error.issue?.module ? { frames: diagnosticFrames(error) } : {}),
      },
    })
    throw new TransportFailure(
      operation,
      {
        ...sanitized,
        issue: {
          ...sanitized.issue,
          traceId: sanitized.issue.traceId || traceId,
          outcome: cancelled ? "unknown" : outcome,
        },
      },
      error
    )
  } finally {
    inFlight.delete(operationPromise)
    requests.delete(id)
  }
}
const runtime = process.env.MOON_RUNTIME_FILE
  ? await startRuntime(process.env.MOON_RUNTIME_FILE, dispatch, publicFailure)
  : undefined
let runtimeClosed = false
async function closeRuntime() {
  if (!runtimeClosed) {
    await runtime?.close()
    runtimeClosed = true
  }
}
async function validateStorage() {
  // Desktop startup shares the browser's domain-isolation contract. Strict
  // all-domain validation remains owned by offline maintenance.
  return validateDomains(
    (await ensureInitialized()).storageReaders(),
    directory
  )
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
function send(value) {
  process.stdout.write(JSON.stringify(value) + "\n")
}
connectDirectoryHost(send)
input.on("line", (line) => {
  if (line.length > 16 * 1024 * 1024) return
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  if (acceptDirectoryReply(request)) return
  if (
    !["materialUpload", "pluginCall"].includes(request.operation) &&
    line.length > 1024 * 1024
  ) {
    send({ id: request.id, error: "请求参数过大。" })
    return
  }
  if (request.operation === "$cancel") {
    pending.get(request.id)?.abort()
    return
  }
  if (typeof request.id !== "string" || pending.has(request.id)) return
  const controller = new AbortController()
  pending.set(request.id, controller)
  // 内部维护只在受宿主持有的stdin分派；loopback HTTP永不接受$命令。
  const task =
    request.operation === "$runtime"
      ? Promise.resolve(runtime?.info ?? { version })
      : request.operation === "$maintenance"
        ? maintenance.execute(request.input).then(async (result) => {
            if (result.closed) await closeRuntime()
            return result
          })
        : request.operation === "$validateStorage"
          ? validateStorage()
          : withRequestContext(
              {
                source: "local",
                clientId: "desktop",
                connectionId: "desktop",
                viewGeneration: 0,
                // G10：桌面命令信封携带的 traceId 原样进入上下文（格式校验在 Rust 侧）
                traceId:
                  typeof request.traceId === "string"
                    ? request.traceId
                    : undefined,
              },
              () =>
                dispatch(request.operation, request.input, controller.signal)
            )
  task
    .then((result) => send({ id: request.id, result }))
    .catch((error) =>
      send({
        id: request.id,
        ...publicFailure(
          request.operation.startsWith("$") &&
            error?.name !== "MoonOperationError"
            ? operationError(
                "maintenance_unconfirmed",
                "宿主维护或存储恢复尚未确认，原数据与原请求身份保留，请重新启动后检查。",
                "restart"
              )
            : error,
          request.operation,
          controller.signal.aborted
        ),
      })
    )
    .finally(() => pending.delete(request.id))
})
input.on("close", async () => {
  closing = true
  closeDirectoryHost()
  for (const controller of pending.values()) controller.abort()
  await service?.close()
  await closeRuntime()
  // Let cancelled writes reach their finally blocks before terminating Node.
  await Promise.allSettled([...inFlight])
  // T20-3：退出前排空操作终态日志队列，终态记录不因进程退出丢失
  await operationLogger.close()
  process.exit(0)
})
