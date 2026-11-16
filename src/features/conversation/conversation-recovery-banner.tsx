import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Button } from "@/components/ui/button"
import type {
  ConversationSnapshot,
  OperationIssue,
} from "@/contracts/rpc.generated"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { ConversationOperationFeedback } from "./conversation-operation-feedback"
import type { ConversationSubmissionEchoValue } from "./conversation-submission"
import type { useConversationCommand } from "./controls/use-command-controller"
import type { ConversationActionIssue } from "./use-live-conversation"

export function CommandRecoveryFeedback({
  command,
}: {
  command: ReturnType<typeof useConversationCommand>
}) {
  if (!command.pending && !command.issue) return null
  return (
    <OperationFeedback
      notify={false}
      density="compact"
      title={
        command.receipt?.status === "started"
          ? `正在执行 /${command.receipt.name}`
          : command.receipt?.status === "failed"
            ? "扩展命令未完成"
            : "扩展命令待核对"
      }
      message={`扩展命令${command.receipt?.name ? ` /${command.receipt.name}` : ""}：${
        command.issue?.message ??
        command.receipt?.issue?.summary ??
        "原命令与参数已保留；核对不会重复执行。"
      }`}
      severity={command.receipt?.status === "failed" ? "error" : "info"}
      actions={
        (command.pending || command.storageBlocked) && (
          <Button
            size="sm"
            variant="outline"
            disabled={command.checking}
            onClick={() => {
              if (
                command.receipt &&
                ["completed", "failed"].includes(command.receipt.status)
              )
                command.acknowledge()
              else void command.check()
            }}
          >
            {command.receipt &&
            ["completed", "failed"].includes(command.receipt.status)
              ? "清理原回执"
              : "核对原命令"}
          </Button>
        )
      }
    />
  )
}

export function ConversationRecoveryBanner({
  snapshot,
  needsResend,
  pendingQueue,
  unconfirmed,
  runIssue,
  onOpenSettings,
  hasModelCatalog,
  pendingSubmission,
  inlineActionIssue,
  draftError,
  receiptIssue,
  onCleanReceipt,
  pending,
  stopPending,
  readPending,
  onReload,
  onReconcile,
  onSaveDraft,
  onStop,
  onContinue,
  mutationBlockedReason,
}: {
  snapshot?: ConversationSnapshot
  needsResend: boolean
  pendingQueue: boolean
  unconfirmed?: boolean
  runIssue?: OperationIssue
  onOpenSettings?: () => void
  hasModelCatalog: boolean
  pendingSubmission?: ConversationSubmissionEchoValue
  inlineActionIssue?: ConversationActionIssue
  draftError?: string
  receiptIssue?: FeedbackDescription
  onCleanReceipt?: () => void
  pending?: boolean
  stopPending?: boolean
  readPending?: boolean
  onReload: () => void
  onReconcile?: () => void
  onSaveDraft?: () => void
  onStop: () => void
  onContinue: () => void
  mutationBlockedReason?: string
}) {
  const showBanner =
    snapshot?.notice ||
    snapshot?.historyNotice ||
    needsResend ||
    inlineActionIssue ||
    draftError ||
    receiptIssue

  if (!showBanner) return null

  return (
    <div className="flex flex-col gap-2">
      {snapshot?.historyNotice && (
        <OperationFeedback
          notify={false}
          density="compact"
          title="历史记录提示"
          message={`历史记录：${snapshot.historyNotice}`}
          severity="info"
        />
      )}
      {snapshot?.notice && (
        <OperationFeedback
          notify={false}
          density="compact"
          title={
            snapshot.notice.kind === "input-handled"
              ? "扩展已处理输入"
              : "上下文压缩未完成"
          }
          message={`${
            snapshot.notice.kind === "input-handled" ? "扩展输入" : "上下文压缩"
          }：${snapshot.notice.message}`}
          severity="warning"
        />
      )}
      {needsResend && !pendingQueue && !unconfirmed && (
        <OperationFeedback
          notify={false}
          density="compact"
          title="消息尚未发送"
          message={runIssue?.summary ?? "内容已保留，请修正后在输入框发送。"}
          details={runIssue?.details}
          severity={snapshot?.phase === "interrupted" ? "info" : "error"}
          actions={
            runIssue?.recovery === "settings" &&
            hasModelCatalog && (
              <Button variant="outline" size="sm" onClick={onOpenSettings}>
                检查模型设置
              </Button>
            )
          }
        />
      )}
      <ConversationOperationFeedback
        submissionKind={pendingSubmission?.kind}
        actionIssue={inlineActionIssue}
        draftError={draftError}
        receiptIssue={receiptIssue}
        onCleanReceipt={onCleanReceipt}
        unconfirmed={false}
        pending={
          pending || (inlineActionIssue?.action === "stop" && stopPending)
        }
        readPending={readPending}
        onReload={onReload}
        onReconcile={onReconcile}
        onSaveDraft={onSaveDraft}
        onStop={onStop}
        onContinue={onContinue}
        continueDisabledReason={mutationBlockedReason}
        onOpenSettings={onOpenSettings}
      />
    </div>
  )
}
