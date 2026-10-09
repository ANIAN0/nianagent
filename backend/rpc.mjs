import { createInterface } from "node:readline"
import { randomUUID } from "node:crypto"
import { prepareNodeStorage } from "./storage-bootstrap.mjs"
import { validateStorage as validateSavedStorage } from "./storage-validation.mjs"
import { DesktopMaintenance } from "./desktop-maintenance.mjs"
import { startRuntime, runtimeVersion } from "./runtime.mjs"
import { operationError, publicFailure } from "./operation-issue.mjs"
import {
  connectDirectoryHost,
  acceptDirectoryReply,
  closeDirectoryHost,
} from "./native-directory.mjs"

const { directory } = prepareNodeStorage()
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
  const candidate = new MoonServices(directory)
  candidate.conversations.maintenanceFrozen = Boolean(maintenance.operationId)
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
  const operationPromise = execute(operation, input, signal)
  requests.set(id, {
    operation,
    sessionId: input?.sessionId,
    done: operationPromise,
  })
  inFlight.add(operationPromise)
  try {
    return await operationPromise
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
  return validateSavedStorage(await ensureInitialized(), directory)
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
  if (request.operation !== "materialUpload" && line.length > 1024 * 1024) {
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
          : dispatch(request.operation, request.input, controller.signal)
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
  process.exit(0)
})
