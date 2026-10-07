import { FileWarning, RotateCw, Settings } from "lucide-react"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { StatusMessage } from "@/components/feedback/status-message"
import type { FeedbackDescription } from "@/lib/operation-issue"

/** Keep the reason and its recovery together without moving the reading anchor. */
export function ConversationReadFeedback({
  issue,
  hasHistory,
  retrying = false,
  onRetry,
  onOpenSettings,
}: {
  issue: FeedbackDescription
  hasHistory: boolean
  retrying?: boolean
  onRetry?: () => void
  onOpenSettings?: () => void
}) {
  const recovery = (
    <RecoveryAction
      issue={issue}
      variant={hasHistory ? "link" : "default"}
      className="conversation-read-recovery"
      icon={
        issue.recovery === "settings" ? (
          <Settings data-icon="inline-start" />
        ) : (
          <RotateCw
            data-icon="inline-start"
            className={
              retrying ? "animate-spin motion-reduce:animate-none" : undefined
            }
          />
        )
      }
      disabled={
        retrying &&
        !["settings", "restart", "none"].includes(issue.recovery ?? "reload")
      }
      onRetry={onRetry}
      onReload={onRetry}
      onCheck={onRetry}
      onSettings={onOpenSettings}
      labels={{
        retry: retrying
          ? "正在重新加载…"
          : hasHistory
            ? "重试"
            : "重新加载会话",
        reload: retrying
          ? "正在重新加载…"
          : hasHistory
            ? "重试"
            : "重新加载会话",
        check: "检查会话状态",
        settings: "检查模型设置",
      }}
    />
  )
  if (hasHistory) {
    return (
      <div className="conversation-read-feedback" aria-label="会话历史更新失败">
        <StatusMessage title="历史更新失败" message={issue.message} />
        {recovery}
      </div>
    )
  }
  return (
    <Empty className="conversation-read-empty" role="status">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileWarning />
        </EmptyMedia>
        <EmptyTitle>暂时无法加载会话</EmptyTitle>
        <EmptyDescription>{issue.message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{recovery}</EmptyContent>
    </Empty>
  )
}
