import { randomUUID } from "node:crypto"
let send
const pending = new Map()
export function connectTranslationHost(write) {
  send = write
}
export function closeTranslationHost() {
  send = undefined
  for (const finish of pending.values()) finish("桌面宿主已退出。")
}
export function acceptTranslationReply(message) {
  if (message.operation !== "$selectionTranslateReply") return false
  pending.get(message.id)?.(message.error)
  return true
}
export async function setTranslationEnabled(enabled) {
  if (!enabled && (!send || !process.env.MOON_DESKTOP_PID)) return
  if (!send || !process.env.MOON_DESKTOP_PID)
    throw new Error("划词翻译需要 Moon 桌面宿主。")
  const id = randomUUID()
  return await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer)
      pending.delete(id)
      if (error) reject(new Error(error))
      else resolve()
    }
    const timer = setTimeout(() => finish("桌面快捷键操作超时。"), 10000)
    pending.set(id, finish)
    try {
      send({ operation: "$selectionTranslate", id, enabled })
    } catch {
      finish("桌面宿主连接已关闭。")
    }
  })
}
