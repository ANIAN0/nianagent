import { modelFailureIssue, publicFailure } from "./operation-issue.mjs"
import { issueSchemas } from "./issue-contract.mjs"
import { assertSchema } from "./schema.mjs"

/** Pi 身份、接收事实与安全诊断；不持有会话执行资源。 */
export const requireValue = (value, message) => {
  if (!value) throw new Error(message)
}
export const textOf = (content) =>
  typeof content === "string"
    ? content
    : (content || [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
export const excerpt = (value, length = 32000) =>
  value.length > length ? value.slice(0, length) + "\n[输出已截断]" : value
export const providerId = (connection) =>
  connection.kind === "subscription"
    ? connection.providerId
    : `moon-${connection.id}`
export const selectionId = (connectionId, modelId) =>
  `${connectionId}/${modelId}`
export const identity = (value) =>
  requireValue(
    typeof value === "string" &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(value) &&
      !["__proto__", "constructor", "prototype"].includes(value),
    "会话或请求标识无效。"
  )
export const errorText = (error) => runFailureIssue(error).summary
export const restoredIssue = (value) => {
  if (!value) return undefined
  try {
    assertSchema(issueSchemas.OperationIssue, value, "运行反馈")
    if (
      /https?:|Bearer|api[_-]?key|[A-Z]:[\\/]|\bat\s+\S+\(/i.test(
        JSON.stringify(value)
      )
    )
      return undefined
    return structuredClone(value)
  } catch {
    return undefined
  }
}
export const storageIssue = (error, operation, summary, code) => {
  const source =
    error?.name === "QueueDispatchPersistenceError" && !error.issue
      ? error.cause || new Error("本地存储操作失败。")
      : error
  const safe = publicFailure(source, operation).issue
  return {
    ...safe,
    code:
      code ||
      (safe.code.startsWith("storage_") ? safe.code : "history_save_failed"),
    summary,
    recovery: "reload",
  }
}
export const runFailureIssue = (error) =>
  error?.name === "QueueDispatchPersistenceError" && !error.issue
    ? storageIssue(
        error,
        "conversationSend",
        "待处理消息未能保存，消息保留且尚未发送。",
        "queue_storage"
      )
    : modelFailureIssue(error)
export const queueFailure = (state, error, summary) => {
  state.queueIssue = storageIssue(
    error,
    "conversationRead",
    summary,
    "queue_storage"
  )
  state.queueError = state.queueIssue.summary
}
export const continuation =
  "请继续完成上一条用户请求；保留已经完成的工作和工具结果，不要重复执行已经成功的操作。"
export const acceptedRequestIds = (manager) => {
  const accepted = new Set()
  let precedingRequest
  // Acceptance belongs to the whole append-only Pi history, even after the
  // active leaf changes. A request marker alone is never input acceptance.
  for (const entry of manager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "moon-request")
      precedingRequest = entry.data?.clientRequestId
    if (
      (entry.type === "message" && entry.message.role === "user") ||
      (entry.type === "custom_message" &&
        entry.customType === "moon-continuation")
    ) {
      if (precedingRequest) accepted.add(precedingRequest)
      precedingRequest = undefined
    }
  }
  return accepted
}
export const acceptedInput = (manager, clientRequestId) =>
  acceptedRequestIds(manager).has(clientRequestId)
export const shellResult = (result, name) => {
  if (!["bash", "powershell"].includes(name)) return {}
  const content = result?.structuredContent
  if (!content || typeof content !== "object") return {}
  return {
    ...(Number.isInteger(content.exit_code)
      ? { exitCode: content.exit_code }
      : {}),
    ...(Number.isFinite(content.wall_time_seconds) &&
    content.wall_time_seconds >= 0
      ? { durationMs: Math.round(content.wall_time_seconds * 1000) }
      : {}),
  }
}
export const toolOccurrenceKey = (entryId, index) =>
  JSON.stringify([entryId, index])
export const savedShellResult = (data) => ({
  ...(Number.isInteger(data.exitCode) ? { exitCode: data.exitCode } : {}),
  ...(Number.isFinite(data.durationMs) && data.durationMs >= 0
    ? { durationMs: data.durationMs }
    : {}),
})
export const compactionReason = (reason) =>
  reason === "overflow"
    ? "上下文超过限制，Pi 正在压缩对话历史。"
    : reason === "manual"
      ? "Pi 正在压缩会话上下文。"
      : "上下文接近上限，Pi 正在压缩历史。"
export const compactionErrorText = (message) =>
  errorText(
    String(message).replace(
      /^(Auto-compaction failed|Context overflow recovery failed):\s*/i,
      ""
    )
  )
