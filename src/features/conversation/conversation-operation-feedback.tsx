import { Button } from "@/components/ui/button"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { FeedbackDescription } from "@/lib/operation-issue"
import type { ConversationActionIssue } from "./use-live-conversation"

export function ConversationOperationFeedback({
  readIssue,
  actionIssue,
  draftError,
  receiptIssue,
  onCleanReceipt,
  unconfirmed,
  submissionKind,
  pending,
  readPending,
  onReload,
  onReconcile,
  onSaveDraft,
  onStop,
  onContinue,
  continueDisabledReason,
  onOpenSettings,
}: {
  readIssue?: FeedbackDescription
  actionIssue?: ConversationActionIssue
  draftError?: string
  receiptIssue?: FeedbackDescription
  onCleanReceipt?: () => void
  unconfirmed?: boolean
  submissionKind?: "send" | "retry"
  pending?: boolean
  readPending?: boolean
  onReload: () => void
  onReconcile?: () => void
  onSaveDraft?: () => void
  onStop: () => void
  onContinue: () => void
  continueDisabledReason?: string
  onOpenSettings?: () => void
}) {
  const unknown = actionIssue?.code === "result_unknown"
  const sendUnknown =
    unconfirmed &&
    (!actionIssue ||
      ["send", "retry", "reconcile"].includes(actionIssue.action))
  const action = actionIssue?.action
  const originalIsRetry =
    submissionKind === "retry" || (!submissionKind && action === "retry")
  const cancelled = actionIssue?.code === "cancelled"
  const separateReceiptUnknown = unconfirmed && action === "stop"
  const originalReceiptMessage =
    "原消息或继续请求的接收结果仍待确认。内容已保留，请先核对原请求；核对不会再次发送。"
  const actionReadsSnapshot =
    actionIssue?.recovery === "reload" ||
    (actionIssue?.recovery === "check" && !sendUnknown) ||
    (!actionIssue?.recovery && action === "send")
  return (
    <div className="flex flex-col gap-2">
      {readIssue && (
        <OperationFeedback
          title="会话刷新失败"
          {...readIssue}
          severity="warning"
          actions={
            <RecoveryAction
              issue={readIssue}
              onRetry={onReload}
              onReload={onReload}
              onCheck={onReload}
              onSettings={onOpenSettings}
              disabled={
                pending ||
                (readPending &&
                  !["settings", "restart", "none"].includes(
                    readIssue.recovery ?? "retry"
                  ))
              }
              labels={{
                retry: "重新读取会话",
                reload: "重新读取会话",
                check: "核对会话状态",
                settings: "检查模型设置",
              }}
            />
          }
        />
      )}
      {separateReceiptUnknown && (
        <OperationFeedback
          title="原请求接收结果待确认"
          message={originalReceiptMessage}
          severity="warning"
          actions={
            <RecoveryAction
              issue={{
                code: "result_unknown",
                message: originalReceiptMessage,
                recovery: "check",
              }}
              onCheck={onReconcile}
              disabled={pending}
              labels={{ check: "核对原请求" }}
            />
          }
        />
      )}
      {(sendUnknown || actionIssue) && (
        <OperationFeedback
          title={
            sendUnknown
              ? originalIsRetry
                ? "继续请求待确认"
                : "发送结果待确认"
              : cancelled
                ? "本次操作已取消"
                : unknown
                  ? action === "stop"
                    ? "停止结果待确认"
                    : "操作结果待确认"
                  : action === "stop"
                    ? "停止请求未完成"
                    : action === "retry"
                      ? "继续回复未完成"
                      : action === "reconcile"
                        ? "发送记录未能核对"
                        : "消息未发送"
          }
          message={
            actionIssue?.message ??
            (originalIsRetry
              ? "尚未确认继续请求是否已接受。下一稿和材料已保留，未随此次继续请求发送；请先核对原请求。"
              : "尚未确认原消息是否已接受。输入内容已保留，请先核对原请求。")
          }
          details={actionIssue?.details}
          severity={
            sendUnknown || unknown
              ? "warning"
              : (actionIssue?.severity ?? (cancelled ? "info" : "error"))
          }
          actions={
            <RecoveryAction
              issue={
                actionIssue ?? {
                  message: "尚未确认原请求是否已接受。",
                  code: "result_unknown",
                  recovery: "check",
                }
              }
              onRetry={
                action === "stop"
                  ? onStop
                  : action === "retry"
                    ? onContinue
                    : action === "reconcile"
                      ? onReconcile
                      : undefined
              }
              onReload={onReload}
              onCheck={sendUnknown ? onReconcile : onReload}
              onSettings={onOpenSettings}
              disabled={
                pending ||
                (readPending && actionReadsSnapshot) ||
                (action === "retry" &&
                  (actionIssue?.recovery ?? "retry") === "retry" &&
                  !sendUnknown &&
                  !unknown &&
                  !!continueDisabledReason)
              }
              labels={{
                retry:
                  action === "stop"
                    ? "再次请求停止"
                    : action === "retry"
                      ? "继续上次回复"
                      : originalIsRetry
                        ? "核对继续请求"
                        : "核对发送",
                reload: "重新读取会话",
                check: sendUnknown
                  ? originalIsRetry
                    ? "核对继续请求"
                    : "核对发送"
                  : "核对运行状态",
                settings: "检查模型设置",
              }}
            />
          }
        />
      )}
      {draftError && (
        <OperationFeedback
          title="草稿尚未保存到本机"
          message={draftError}
          severity="warning"
          actions={
            onSaveDraft && (
              <Button variant="outline" size="sm" onClick={onSaveDraft}>
                重试保存草稿
              </Button>
            )
          }
        />
      )}
      {receiptIssue && (
        <OperationFeedback
          title="本地回执尚未清理"
          {...receiptIssue}
          severity="warning"
          actions={
            onCleanReceipt && (
              <Button variant="outline" size="sm" onClick={onCleanReceipt}>
                重试清理回执
              </Button>
            )
          }
        />
      )}
    </div>
  )
}
