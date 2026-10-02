import { createInterface } from "node:readline"
import { join } from "node:path"
import { homedir } from "node:os"
import { ModelService } from "./models.mjs"

const directory =
  process.env.MOON_DATA_DIR ||
  join(
    process.env.LOCALAPPDATA || join(homedir(), ".local", "share"),
    "Moon",
    "models"
  )
const service = new ModelService(directory)
const pending = new Map()
// Keep the transport alive even when initialization fails: both native and web
// callers must receive the actual safe configuration error, not a process hint.
let initialized
function ensureInitialized() {
  initialized ??= service.initialize().catch((error) => {
    initialized = undefined
    throw error
  })
  return initialized
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
function send(value) {
  process.stdout.write(JSON.stringify(value) + "\n")
}
input.on("line", (line) => {
  if (line.length > 1024 * 1024) return
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  if (request.operation === "$cancel") {
    pending.get(request.id)?.abort()
    return
  }
  if (typeof request.id !== "string" || pending.has(request.id)) return
  const controller = new AbortController()
  pending.set(request.id, controller)
  ensureInitialized()
    .then(() => {
      return service.dispatch(
        request.operation,
        request.input,
        controller.signal
      )
    })
    .then((result) => send({ id: request.id, result }))
    .catch((error) =>
      send({
        id: request.id,
        error: controller.signal.aborted ? "请求已取消。" : publicError(error),
      })
    )
    .finally(() => pending.delete(request.id))
})
function publicError(error) {
  if (error?.name === "ContractError") return error.message
  // Never forward provider response bodies, URLs, headers or raw SDK errors.
  return error instanceof Error &&
    /[\u4e00-\u9fff]/u.test(error.message) &&
    !/https?:|Bearer|api[_-]?key/i.test(error.message)
    ? error.message
    : "模型服务操作失败，请检查配置和服务状态。"
}
input.on("close", () => {
  for (const controller of pending.values()) controller.abort()
  service.close()
  process.exit(0)
})
