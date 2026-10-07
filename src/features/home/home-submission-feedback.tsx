import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Button } from "@/components/ui/button"

export function HomeSubmissionFeedback({
  message,
  onRetry,
  actionLabel = "重试清理",
  pending = false,
  variant = "destructive",
}: {
  message: string
  onRetry: () => void
  actionLabel?: string
  pending?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <OperationFeedback
      notify={false}
      title={pending ? "正在完成草稿交接" : "首页提交需要处理"}
      message={message}
      severity={variant === "default" ? "info" : "warning"}
      actions={
        !pending && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {actionLabel}
          </Button>
        )
      }
    />
  )
}
