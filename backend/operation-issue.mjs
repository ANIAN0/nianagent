const issue = (code, summary, recovery = "retry", details) => ({
  code,
  summary,
  recovery,
  severity:
    code === "cancelled"
      ? "info"
      : code === "result_unknown"
        ? "warning"
        : "error",
  ...(details ? { details } : {}),
})
const storageCodes = new Set([
  "EPERM",
  "EACCES",
  "EBUSY",
  "ENOSPC",
  "EIO",
  "ENOENT",
])
const safeSummary = (value) =>
  typeof value === "string" &&
  /[\u4e00-\u9fff]/u.test(value) &&
  !/https?:|Bearer|api[_-]?key|[A-Z]:[\\/]|\bat\s+\S+\(/i.test(value)

export function operationError(code, summary, recovery = "retry", details) {
  const error = new Error(summary)
  error.name = "MoonOperationError"
  error.issue = issue(code, summary, recovery, details)
  return error
}

/** Only fixed diagnostics cross the service boundary; raw SDK bodies stay private. */
export function modelFailureIssue(error) {
  if (error?.name === "QueueDispatchPersistenceError") return error.issue
  const message = error instanceof Error ? error.message : String(error)
  if (/401|unauthoriz|invalid.{0,12}(api.?key|credential)/i.test(message))
    return issue(
      "model_authentication",
      "模型认证失败，请检查连接凭据。",
      "settings",
      "提供方状态：HTTP 401。"
    )
  if (/403|forbidden|permission.denied/i.test(message))
    return issue(
      "model_access",
      "账号没有访问此模型的权限，请检查连接设置。",
      "settings",
      "提供方状态：HTTP 403。"
    )
  if (/429|rate.?limit|too.many.requests/i.test(message))
    return issue(
      "model_busy",
      "模型服务请求过于频繁，请稍后继续。",
      "retry",
      "提供方状态：HTTP 429。"
    )
  if (/\b50[0-9]\b|overload|service.unavailable/i.test(message))
    return issue(
      "model_unavailable",
      "模型服务暂时不可用，请稍后继续。",
      "retry",
      "提供方状态：服务端错误。"
    )
  if (
    /context.{0,20}(length|window|exceed|overflow)|token.{0,15}limit/i.test(
      message
    )
  )
    return issue(
      "context_limit",
      "当前上下文超过模型限制，请压缩上下文或选择容量更大的模型。",
      "settings"
    )
  if (/timeout|timed.out|ETIMEDOUT/i.test(message))
    return issue(
      "model_timeout",
      "等待模型回复超时，请检查连接后继续。",
      "retry"
    )
  if (/ENOSPC|disk.{0,10}full/i.test(message))
    return issue(
      "storage_space",
      "本地磁盘空间不足，无法保存会话，请释放空间后重试。",
      "retry",
      "存储错误码：ENOSPC。"
    )
  if (/EACCES|EPERM/i.test(message))
    return issue(
      "storage_access",
      "会话文件暂时无法写入，请检查磁盘权限或文件占用后重试。",
      "retry",
      "存储原因：写入被拒绝。"
    )
  if (/abort|请求已停止/i.test(message))
    return issue("cancelled", "本次执行已停止。", "none")
  if (/400|invalid.request/i.test(message))
    return issue(
      "model_request_invalid",
      "模型服务拒绝了请求，请检查模型、协议和能力配置。",
      "settings",
      "提供方状态：HTTP 400。"
    )
  if (/fetch.failed|ECONN|ENOTFOUND|network/i.test(message))
    return issue(
      "model_connection",
      "无法连接模型服务，请检查端点和网络。",
      "settings"
    )
  return issue("model_request_failed", "模型请求未完成，请检查连接或稍后继续。")
}

export function publicIssue(error, operation, cancelled = false) {
  if (
    error?.name === "MoonOperationError" &&
    error.issue?.code === "result_unknown"
  )
    return error.issue
  if (cancelled || error?.name === "AbortError")
    return issue("cancelled", "已取消本次操作。", "none")
  if (error?.name === "QueueDispatchPersistenceError") return error.issue
  if (error?.issue && error.name === "MoonOperationError") return error.issue
  if (error?.name === "ContractError")
    return issue(
      "invalid_input",
      safeSummary(error.message)
        ? error.message
        : "输入不符合接口要求，请检查后重试。",
      "none"
    )
  let cause = error
  for (let depth = 0; cause && depth < 5; depth++, cause = cause.cause)
    if (storageCodes.has(cause.code))
      return issue(
        cause.code === "ENOSPC" ? "storage_space" : "storage_access",
        cause.code === "ENOSPC"
          ? "本地存储空间不足，请释放空间后重试。"
          : "本地数据暂时无法读写，请检查权限或文件占用后重试。",
        "retry",
        `存储错误码：${cause.code}。`
      )
  return issue(
    "operation_failed",
    safeSummary(error?.message)
      ? error.message
      : "本次操作未完成，请检查配置和服务状态后重试。",
    /Read|List|Catalog|^list$|^providers$/.test(operation || "")
      ? "reload"
      : "retry"
  )
}

export function publicFailure(error, operation, cancelled = false) {
  const result = publicIssue(error, operation, cancelled)
  return { error: result.summary, issue: result }
}
