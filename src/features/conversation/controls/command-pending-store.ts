export type PendingCommand = {
  version: 1
  sessionId: string
  id: string
  text: string
}
export type CommandRecovery = {
  sessionId: string
  pending?: PendingCommand
  error?: Error
}
const key = (sessionId: string) => `moon.command.pending.v1:${sessionId}`
const identity = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
function decode(value: unknown, sessionId: string): PendingCommand {
  if (!identity(sessionId)) throw new Error("命令会话身份无效，尚未执行。")
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("命令恢复记录结构无效。")
  const record = value as Record<string, unknown>
  if (
    !identity(record.id) ||
    typeof record.text !== "string" ||
    record.text.length > 100201 ||
    (record.version !== undefined && record.version !== 1) ||
    (record.sessionId !== undefined && record.sessionId !== sessionId)
  )
    throw new Error("命令恢复记录身份无效。")
  // 旧 v1 以实际读取的会话 key 绑定；读取失败不能清空或自动重发。
  return { version: 1, sessionId, id: record.id, text: record.text }
}
export function readCommandPending(sessionId: string): CommandRecovery {
  try {
    const raw = localStorage.getItem(key(sessionId))
    return {
      sessionId,
      ...(raw === null ? {} : { pending: decode(JSON.parse(raw), sessionId) }),
    }
  } catch (cause) {
    return {
      sessionId,
      error: new Error(
        "原命令恢复记录无法读取，原数据保留。请恢复本机存储后重新核对。",
        { cause }
      ),
    }
  }
}
export function retainCommandPending(value: PendingCommand) {
  decode(value, value.sessionId)
  const existing = readCommandPending(value.sessionId)
  if (existing.error) throw existing.error
  if (existing.pending && existing.pending.id !== value.id)
    throw new Error("请先核对并清理原命令，当前输入保留。")
  localStorage.setItem(key(value.sessionId), JSON.stringify(value))
}
/** 在保留执行身份之前校验 RPC 边界，明确拒绝不能留下永远 unknown 的 pending。 */
export function commandArguments(text: string, name: string) {
  const normalized = text.trim()
  const argumentsText = normalized.slice(name.length + 1).trimStart()
  if (
    !name ||
    name.length > 200 ||
    text.length > 100201 ||
    !normalized.startsWith(`/${name}`) ||
    (normalized.length > name.length + 1 &&
      !/\s/.test(normalized[name.length + 1])) ||
    argumentsText.length > 100000
  )
    throw new Error(
      "命令格式无效或参数超过 100000 字符，尚未执行。请缩短输入后重试。"
    )
  return argumentsText
}
export function clearCommandPending(value: PendingCommand) {
  const existing = readCommandPending(value.sessionId)
  if (existing.error) throw existing.error
  if (existing.pending && existing.pending.id !== value.id)
    throw new Error("本机已保存另一条命令，不能清理其他请求。")
  localStorage.removeItem(key(value.sessionId))
}
