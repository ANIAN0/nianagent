import { currentTraceId } from "./request-context.mjs"
import { randomUUID } from "node:crypto"

// G09：每个终态 issue 携带 errorId（可定位唯一日志与责任模块）；traceId 随上下文贯通（G10）。
const issue = (code, summary, recovery = "retry", details) => ({
  code,
  summary,
  recovery,
  errorId: randomUUID().slice(0, 8),
  traceId: currentTraceId(),
  severity:
    code === "cancelled"
      ? "info"
      : code === "result_unknown"
        ? "warning"
        : "error",
  // T20-2：领域回执自带终态——result_unknown 明确表示无法证明已提交或被拒，
  // 消费方不得按错误类改判为 rejected。
  ...(code === "result_unknown" ? { outcome: "unknown" } : {}),
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
  const notFound =
    /^(?:HTTP\s*)?404\b|\b(?:HTTP|status(?:_code)?)[\s:"'=]*404\b/i.test(
      message
    )
  if (notFound || /model.{0,20}(?:not.found|does.not.exist)/i.test(message))
    return issue(
      "model_not_found",
      "模型或接口未找到，请检查模型 ID、协议和端点。",
      "settings",
      notFound ? "提供方状态：HTTP 404。" : undefined
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
  if (/timeout|timed.out|ETIMEDOUT|等待模型回复超时/i.test(message))
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
  if (/\b400\b|invalid.request/i.test(message)) {
    const parameter = /\bmax_completion_tokens\b/i.test(message)
      ? "max_completion_tokens"
      : /\bmax_tokens\b|\bMaxTokens\b/i.test(message)
        ? "max_tokens"
        : /\breasoning_effort\b|\bReasoningEffort\b/i.test(message)
          ? "reasoning_effort"
          : undefined
    const roleFailure =
      !parameter &&
      /\b(?:developer|(?:messages(?:\[\d+\])?\.)?role)\b.{0,80}\b(?:unsupported|invalid|not\s+(?:supported|accepted|allowed)|does\s+not\s+support)\b|\b(?:unsupported|invalid|not\s+(?:supported|accepted|allowed)|does\s+not\s+support)\b.{0,80}\b(?:developer|(?:messages(?:\[\d+\])?\.)?role)\b/i.test(
        message
      )
    const status =
      /^(?:HTTP\s*)?400\b|\b(?:HTTP|status(?:_code)?)[\s:"'=]*400\b/i.test(
        message
      )
        ? "提供方状态：HTTP 400。"
        : "提供方原因：请求无效。"
    return issue(
      "model_request_invalid",
      roleFailure
        ? "该服务不接受当前系统说明角色，请在模型设置调整系统说明角色。"
        : parameter === "reasoning_effort"
          ? "模型服务拒绝了思考等级，请检查模型支持的等级配置。"
          : parameter
            ? "模型服务拒绝了最大输出设置，请检查模型的输出上限。"
            : "模型服务拒绝了请求，请检查模型、协议和能力配置。",
      "settings",
      `${status}${roleFailure ? " 参数：系统说明角色。" : parameter ? ` 参数：${parameter}。` : ""}`
    )
  }
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

// T20-1/AC14：同一次失败在同一操作上下文内只规范一次——以 error 对象为一级键、
// 「操作名/取消态/链路」为二级键缓存规范脱敏结果，终态日志与各层响应复用同一 issue
// （同 errorId）。同一 error 实例进入不同操作或链路（如 trace-A 普通失败、trace-B 取消）
// 时各自规范，取消码与 traceId 不跨操作混淆；并发操作之间不共享身份。
const canonicalFailures = new WeakMap()
/** A terminal transport result retains its identity after leaving AsyncLocalStorage. */
export class TransportFailure extends Error {
  constructor(operation, failure, cause) {
    super(failure.error, { cause })
    this.name = "TransportFailure"
    this.operation = operation
    this.failure = Object.freeze({
      ...failure,
      issue: Object.freeze({ ...failure.issue }),
    })
  }
}

export function publicFailure(error, operation, cancelled = false) {
  if (error instanceof TransportFailure && error.operation === operation)
    return error.failure
  const memoizable = error instanceof Object
  const key = `${operation ?? ""}\u0000${cancelled ? 1 : 0}\u0000${currentTraceId()}`
  const cached = memoizable ? canonicalFailures.get(error)?.get(key) : undefined
  if (cached) return cached
  const result = publicIssue(error, operation, cancelled)
  const failure = { error: result.summary, issue: result }
  if (memoizable) {
    const perError = canonicalFailures.get(error) ?? new Map()
    perError.set(key, failure)
    if (!canonicalFailures.has(error)) canonicalFailures.set(error, perError)
  }
  return failure
}
