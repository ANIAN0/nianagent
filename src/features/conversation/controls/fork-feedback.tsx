import { LoaderCircle } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Button } from "@/components/ui/button"
import type { ConversationControlOperation } from "@/features/models/model-contract.generated"
import { feedbackFromError } from "@/lib/operation-issue"
import type { ConversationControlAction } from "./use-conversation-controls"

export type ForkFeedbackProps = {
  operation: ConversationControlOperation
  error?: string
  issue?: { message: string; details?: string }
  pending?: boolean
  pendingAction?: ConversationControlAction
  onCheck: () => void
  onRetry?: () => void
  onOpen?: (id: string) => void
}

/** Render at the source reply; this component never creates or opens automatically. */
export function ForkFeedback({
  operation,
  error,
  issue,
  pending,
  pendingAction,
  onCheck,
  onRetry,
  onOpen,
}: ForkFeedbackProps) {
  if (operation.kind !== "fork") return null
  const unknown = operation.status === "unknown"
  const failed = operation.status === "failed"
  const completed = operation.status === "completed"
  const submitting = pending && pendingAction === "fork"
  const checking = pending && pendingAction === "check"
  const feedback =
    issue ??
    (error || operation.error
      ? feedbackFromError(error || operation.error)
      : undefined)
  const title = completed
    ? "会话分支已创建"
    : unknown && !submitting
      ? "分支结果待确认"
      : failed
        ? "会话分支未创建"
        : submitting
          ? "正在提交分支请求"
          : "正在创建会话分支"
  const message = completed
    ? "原会话与未发送内容保留。"
    : feedback?.message ||
      (unknown && !submitting
        ? "尚未确认是否创建成功。请先检查结果，避免重复创建。"
        : failed
          ? "没有创建新会话，原会话保持不变。"
          : "将从这条回复创建独立会话，完成后自动打开。")

  return (
    <OperationFeedback
      title={title}
      message={message}
      details={completed ? undefined : feedback?.details}
      severity={
        completed
          ? "info"
          : failed
            ? "error"
            : unknown && !submitting
              ? "warning"
              : feedback
                ? "warning"
                : "info"
      }
      actions={
        (unknown && !submitting) ||
        (failed && onRetry) ||
        (completed && operation.targetSessionId && onOpen) ? (
          <>
            {unknown && !submitting && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={onCheck}
              >
                {checking && (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin motion-reduce:animate-none"
                  />
                )}
                {checking ? "正在检查" : "检查分支结果"}
              </Button>
            )}
            {failed && onRetry && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={onRetry}
              >
                重新创建分支
              </Button>
            )}
            {completed && operation.targetSessionId && onOpen && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpen(operation.targetSessionId!)}
              >
                打开新会话
              </Button>
            )}
          </>
        ) : undefined
      }
    />
  )
}
