import { CircleAlert, RefreshCw, LoaderCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { HistoryState } from "@/features/conversation/conversation-catalog-service"

export type ConversationListFeedbackProps = {
  state?: HistoryState
  error?: string
  hasItems?: boolean
  onRetry?: () => void
}
export function ConversationListFeedback({
  state = "ready",
  error,
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
  return (
    <Alert variant="destructive" className="mb-2 p-3">
      <CircleAlert />
      <AlertTitle className="text-xs">
        {hasItems ? "会话列表未能更新" : "无法读取会话列表"}
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2 text-xs">
        <span className="break-words">{error || "请检查本地服务后重试。"}</span>
        {onRetry && (
          <Button variant="outline" size="xs" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            重新读取
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
