import type { ConversationControlOperation } from "@/features/models/model-contract.generated"
import { RpcRequestRejected } from "@/features/models/model-service"
import { feedbackFromError } from "@/lib/operation-issue"

export type ConversationControlAction = "compact" | "fork" | "check" | "cancel"
export type ConversationControlIssue = ReturnType<typeof feedbackFromError> & {
  operationId: string
  kind: ConversationControlOperation["kind"]
  action: ConversationControlAction
  uncertain?: boolean
}
export const controlStorageKey = (id: string) => `moon.control.pending.${id}`
export const controlIsTerminal = (operation: ConversationControlOperation) =>
  ["completed", "cancelled", "failed"].includes(operation.status)

export function restoreControlOperation(
  id: string
): ConversationControlOperation | undefined {
  try {
    const value: ConversationControlOperation | null = JSON.parse(
      localStorage.getItem(controlStorageKey(id)) || "null"
    )
    return value?.sessionId === id &&
      typeof value.id === "string" &&
      ["compact", "fork"].includes(value.kind) &&
      [
        "running",
        "cancelling",
        "completed",
        "cancelled",
        "failed",
        "unknown",
      ].includes(value.status) &&
      typeof value.createdAt === "string" &&
      typeof value.updatedAt === "string"
      ? value
      : undefined
  } catch {
    return undefined
  }
}

export function controlFailure(
  operation: ConversationControlOperation,
  action: ConversationControlAction,
  reason: unknown
): ConversationControlIssue {
  const fallback =
    action === "check"
      ? "暂时无法确认操作结果，请稍后检查。"
      : action === "cancel"
        ? "取消请求未确认，请先检查压缩状态。"
        : operation.kind === "compact"
          ? "压缩请求结果待确认，请检查压缩状态。"
          : "分支创建结果待确认，请检查分支状态。"
  return {
    ...feedbackFromError(reason, fallback),
    operationId: operation.id,
    kind: operation.kind,
    action,
    uncertain: !(reason instanceof RpcRequestRejected),
  }
}

/** Clear only this operation's issue and only when the receipt resolves its action. */
export function resolveControlIssue(
  issue: ConversationControlIssue | undefined,
  operation: ConversationControlOperation,
  action?: ConversationControlAction
) {
  if (issue?.operationId !== operation.id || issue.kind !== operation.kind)
    return issue
  if (
    issue.action === "cancel" &&
    action !== "cancel" &&
    !controlIsTerminal(operation) &&
    operation.status !== "cancelling"
  ) {
    return issue.uncertain && operation.status === "running"
      ? {
          ...issue,
          uncertain: false,
          message: "取消未生效，压缩仍在进行。可以再次取消。",
        }
      : issue
  }
  return undefined
}
