import { randomUUID } from "node:crypto"

// Only the registered Tauri host may satisfy this capability. There is no shell,
// separate HTTP service, arbitrary command or directory enumeration here.
let hostSend
let pending
export function connectDirectoryHost(send) {
  hostSend = send
}
export function acceptDirectoryReply(message) {
  if (message.operation !== "$hostReply") return false
  if (pending?.id !== message.id) return true
  if (message.error)
    pending.finish(
      new Error(
        [
          "已有目录选择窗口，请先完成或取消。",
          "系统目录选择器需要桌面宿主。",
          "目录路径无法读取。",
        ].includes(message.error)
          ? message.error
          : "无法打开系统目录选择器，请重新打开 Moon 后重试。"
      )
    )
  else if (message.result === null || typeof message.result === "string")
    pending.finish(null, message.result)
  else pending.finish(new Error("系统目录选择器返回了无效路径。"))
  return true
}
export function closeDirectoryHost() {
  pending?.finish(new Error("Moon 正在退出。"))
  hostSend = undefined
}
export function pickNativeDirectory(signal) {
  signal?.throwIfAborted()
  if (!hostSend)
    throw new Error("系统目录选择器需要 Moon 桌面宿主，请先启动 Moon。")
  if (pending) throw new Error("已有目录选择窗口，请先完成或取消。")
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const finish = (error, value) => {
      if (pending?.id !== id) return
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      pending = undefined
      if (error) reject(error)
      else resolve(value)
    }
    const abort = () => finish(signal.reason ?? new Error("请求已取消。"))
    const timer = setTimeout(
      () => finish(new Error("目录选择等待已超时，请关闭目录窗口后重试。")),
      600_000
    )
    pending = { id, finish }
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) return abort()
    try {
      hostSend({ id, operation: "$hostRequest", capability: "pickDirectory" })
    } catch {
      finish(new Error("系统目录选择通道不可用，请重新打开 Moon。"))
    }
  })
}
