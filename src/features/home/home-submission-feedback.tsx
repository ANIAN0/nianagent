import { Alert, AlertDescription } from "@/components/ui/alert"
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
    <Alert
      variant={variant}
      className="shrink-0 rounded-none border-x-0 border-t-0"
    >
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>{message}</span>
        <Button variant="link" size="sm" disabled={pending} onClick={onRetry}>
          {actionLabel}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
