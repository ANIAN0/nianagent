import { transportRecoveryByOperation } from "@/contracts/rpc.generated"
import type {
  ModelOperation,
  RpcRequests,
  RpcResults,
  OperationIssue,
} from "@/contracts/rpc.generated"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { isOperationIssue } from "@/lib/operation-issue"
// 明确拒绝与传输未知分别处理；取消或丢失回复不能证明副作用尚未执行。
export class RpcRequestRejected extends Error {
  readonly issue?: OperationIssue
  constructor(message: string, issue?: OperationIssue) {
    super(issue?.summary ?? message)
    this.name = "RpcRequestRejected"
    this.issue = issue
  }
}
export class RpcTransportError extends Error {
  readonly issue: OperationIssue
  constructor(issue: OperationIssue, cause?: unknown) {
    super(issue.summary, { cause })
    this.name = "RpcTransportError"
    this.issue = issue
  }
}
function transportIssue(
  operation: ModelOperation,
  details?: string
): OperationIssue {
  const recovery = transportRecoveryByOperation[operation]
  return {
    code: "result_unknown",
    summary:
      recovery === "reload"
        ? "无法读取最新内容，请确认 Moon 服务可用后重新读取。"
        : recovery === "none"
          ? "未能确认此次操作的结果。它可能已经完成，为避免重复执行，不提供自动重试。"
          : "未能确认此次操作的结果，当前输入已保留，请先核对原操作。",
    severity: "warning",
    recovery,
    ...(details ? { details } : {}),
  }
}
function rejected(message: string, value: unknown): Error {
  const issue = isOperationIssue(value) ? value : undefined
  return issue?.code === "result_unknown"
    ? new RpcTransportError(issue)
    : new RpcRequestRejected(message, issue)
}
export async function rpcCall<K extends ModelOperation>(
  operation: K,
  input: RpcRequests[K],
  signal?: AbortSignal
): Promise<RpcResults[K]> {
  signal?.throwIfAborted()
  if (isTauri()) {
    const requestId = crypto.randomUUID()
    const abort = () => {
      void invoke("cancel_model_request", { requestId }).catch(() => {})
    }
    signal?.addEventListener("abort", abort, { once: true })
    try {
      const result = await invoke<RpcResults[K]>("model_request", {
        requestId,
        operation,
        input,
      })
      signal?.throwIfAborted()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith("MOON_RPC_REJECTED:")) {
        const contents = message.slice("MOON_RPC_REJECTED:".length)
        let failure: { error: string; issue?: unknown } | undefined
        try {
          failure = JSON.parse(contents)
        } catch {
          /* Older native hosts return a safe string. */
        }
        throw rejected(failure?.error ?? contents, failure?.issue)
      }
      if (message.includes("Command model_request not found")) {
        throw new RpcRequestRejected(
          "当前桌面版本不支持此操作，请更新并重启 Moon。",
          {
            code: "host_version",
            summary: "当前桌面版本不支持此操作，请更新并重启 Moon。",
            recovery: "restart",
            severity: "error",
          }
        )
      }
      if (signal?.aborted) signal.throwIfAborted()
      throw new RpcTransportError(transportIssue(operation), error)
    } finally {
      signal?.removeEventListener("abort", abort)
    }
  }
  try {
    const response = await fetch(`/api/models/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    })
    const payload = await response.json().catch(() => {
      throw new RpcTransportError(
        transportIssue(
          operation,
          `响应状态：HTTP ${response.status}；响应格式无法识别。`
        )
      )
    })
    if (!payload || typeof payload !== "object")
      throw new RpcTransportError(
        transportIssue(operation, "响应缺少有效结果。")
      )
    if (typeof payload.error === "string")
      throw rejected(payload.error, payload.issue)
    if (!response.ok || !("result" in payload))
      throw new RpcTransportError(
        transportIssue(operation, `响应状态：HTTP ${response.status}。`)
      )
    return payload.result as RpcResults[K]
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted()
    if (
      error instanceof RpcRequestRejected ||
      error instanceof RpcTransportError
    )
      throw error
    throw new RpcTransportError(transportIssue(operation), error)
  }
}
