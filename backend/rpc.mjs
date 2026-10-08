import { createInterface } from "node:readline"
import { join } from "node:path"
import { homedir } from "node:os"
import { startRuntime, runtimeVersion } from "./runtime.mjs"
import { operationError, publicFailure } from "./operation-issue.mjs"
import {
  connectDirectoryHost,
  acceptDirectoryReply,
  closeDirectoryHost,
} from "./native-directory.mjs"

const directory =
  process.env.MOON_DATA_DIR ||
  join(
    process.env.LOCALAPPDATA || join(homedir(), ".local", "share"),
    "Moon",
    "models"
  )
let service
const pending = new Map()
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
  return ready.dispatch(operation, input, signal)
}
async function dispatch(operation, input, signal) {
  if (closing) throw new Error("Moon 正在退出。")
  const operationPromise = execute(operation, input, signal)
  inFlight.add(operationPromise)
  try {
    return await operationPromise
  } finally {
    inFlight.delete(operationPromise)
  }
}
const runtime = process.env.MOON_RUNTIME_FILE
  ? await startRuntime(process.env.MOON_RUNTIME_FILE, dispatch, publicFailure)
  : undefined
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
  dispatch(request.operation, request.input, controller.signal)
    .then((result) => send({ id: request.id, result }))
    .catch((error) =>
      send({
        id: request.id,
        ...publicFailure(error, request.operation, controller.signal.aborted),
      })
    )
    .finally(() => pending.delete(request.id))
})
input.on("close", async () => {
  closing = true
  closeDirectoryHost()
  for (const controller of pending.values()) controller.abort()
  await service?.close()
  await runtime?.close()
  // Let cancelled writes reach their finally blocks before terminating Node.
  await Promise.allSettled([...inFlight])
  process.exit(0)
})
