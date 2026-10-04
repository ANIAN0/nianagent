import { transportRecoveryByOperation } from "./model-contract.generated"
import type {
  ModelOperation,
  RpcRequests,
  RpcResults,
  OperationIssue,
} from "./model-contract.generated"
import { invoke, isTauri } from "@tauri-apps/api/core"
import type { ModelService } from "./model-types"
import { isOperationIssue } from "@/lib/operation-issue"
/** A backend rejection is definitive; a lost transport response is not. */
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
export async function modelCall<K extends ModelOperation>(
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
export function createModelService(): ModelService {
  return {
    revealKey: (id, revision, signal) =>
      modelCall("revealKey", { id, revision }, signal),
    list: (signal) => modelCall("list", {}, signal),
    providers: (signal) => modelCall("providers", {}, signal),
    save: (connection, signal, operationRequestId) =>
      modelCall(
        "save",
        {
          ...(operationRequestId ? { operationRequestId } : {}),
          connection: {
            ...connection,
            clearKey:
              connection.credential === "key" &&
              !connection.keySaved &&
              !connection.apiKey,
          },
        },
        signal
      ),
    remove: async (id, signal, revision, operationRequestId) => {
      if (revision === undefined) throw new Error("删除连接需要当前版本。")
      await modelCall(
        "remove",
        { id, revision, ...(operationRequestId ? { operationRequestId } : {}) },
        signal
      )
    },
    readWriteReceipt: (operation, operationRequestId, signal) =>
      modelCall("writeReceiptRead", { operation, operationRequestId }, signal),
    discover: (connection, signal) =>
      modelCall("discover", { connection }, signal),
    check: async (connection, model, signal) => {
      await modelCall("check", { connection, model }, signal)
    },
    authorize: async () => {
      throw new Error("请使用 Pi 授权流程。")
    },
    auth: {
      start: (connection, signal, operationRequestId) =>
        modelCall(
          "authStart",
          { connection, ...(operationRequestId ? { operationRequestId } : {}) },
          signal
        ),
      poll: (id, signal) => modelCall("authPoll", { id }, signal),
      reply: (id, promptId, value, signal) =>
        modelCall("authReply", { id, promptId, value }, signal),
      cancel: async (id) => {
        await modelCall("authCancel", { id })
      },
      logout: (id, signal) => modelCall("logout", { id }, signal),
    },
  }
}
