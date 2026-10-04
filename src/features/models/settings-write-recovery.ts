import type { WriteReceipt } from "./model-contract.generated"
import type { FeedbackDescription } from "@/lib/operation-issue"

export const writeIsUnknown = (issue?: FeedbackDescription) =>
  issue?.code === "result_unknown" || issue?.recovery === "check"

export function unknownWrite(message: string): FeedbackDescription {
  return {
    code: "result_unknown",
    recovery: "check",
    severity: "warning",
    message,
  }
}

/** A directory snapshot cannot certify an individual mutation. */
export async function readSettingsWriteReceipt<
  O extends WriteReceipt["operation"],
>(
  read:
    | ((
        operation: O,
        id: string,
        signal?: AbortSignal
      ) => Promise<WriteReceipt>)
    | undefined,
  attempt: { operation: O; operationRequestId: string; targetId: string },
  signal: AbortSignal
) {
  if (!read)
    throw Object.assign(
      new Error("当前服务不支持写入结果核对，请更新并重启 Moon。"),
      {
        issue: {
          code: "host_version",
          summary: "当前服务不支持写入结果核对，请更新并重启 Moon。",
          recovery: "restart",
          severity: "error",
        },
      }
    )
  const receipt = await read(
    attempt.operation,
    attempt.operationRequestId,
    signal
  )
  signal.throwIfAborted()
  if (
    receipt.operationRequestId !== attempt.operationRequestId ||
    receipt.operation !== attempt.operation ||
    (receipt.state !== "unknown" && receipt.targetId !== attempt.targetId)
  )
    throw Object.assign(new Error("服务返回的回执与本次操作不一致。"), {
      issue: {
        code: "result_unknown",
        summary: "服务返回的回执与本次操作不一致，请保留草稿并稍后核对。",
        recovery: "check",
        severity: "warning",
      },
    })
  return receipt
}
