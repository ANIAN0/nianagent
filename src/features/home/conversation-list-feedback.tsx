import { LoaderCircle } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { Skeleton } from "@/components/ui/skeleton"
import type { HistoryState } from "@/features/conversation/conversation-catalog-service"

export type ConversationListFeedbackProps = {
  state?: HistoryState
  error?: string
  issue?: FeedbackDescription
  hasItems?: boolean
  onRetry?: () => void
}
export function ConversationListFeedback({
  state = "ready",
  error,
  issue,
  hasItems = false,
  onRetry,
}: ConversationListFeedbackProps) {
  if (state === "ready") return null
  if (state === "loading")
    return (
      <div
        role="status"
        aria-label="正在读取会话"
        className="flex flex-col gap-3 px-2 py-3"
      >
        <span className="sr-only">正在读取会话…</span>
        {hasItems && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            正在更新会话…
          </span>
        )}
        {!hasItems && (
          <>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-5 h-5 w-4/5" />
            <Skeleton className="ml-5 h-5 w-3/5" />
            <Skeleton className="ml-5 h-5 w-4/5" />
          </>
        )}
      </div>
    )
  const failure =
    issue ?? feedbackFromError(error, "会话列表暂时无法读取，请重新读取。")
  return (
    <div className="mb-2 px-2 py-1">
      <OperationFeedback
        notify={false}
        title={
          failure.code === "cancelled"
            ? "会话列表读取已取消"
            : hasItems
              ? "会话列表未能更新"
              : "无法读取会话列表"
        }
        {...failure}
        actions={
          <RecoveryAction
            issue={failure}
            onRetry={onRetry}
            onReload={onRetry}
            onCheck={onRetry}
            labels={{
              retry: "重新读取会话列表",
              reload: "重新读取会话列表",
              check: "核对会话列表",
            }}
          />
        }
      />
    </div>
  )
}
