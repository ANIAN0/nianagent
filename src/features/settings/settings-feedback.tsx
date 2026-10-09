import type { Activity, DesktopIssue } from "@/contracts/desktop.generated"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Button } from "@/components/ui/button"
import { DesktopCommandError } from "./desktop-service"

export function desktopIssue(error: unknown): DesktopIssue {
  return error instanceof DesktopCommandError
    ? error.issue
    : {
        code: "internal",
        message: "操作未完成，请重新读取状态后重试。",
        recovery: "retry",
        activities: [],
      }
}
export function ActivityList({ activities }: { activities: Activity[] }) {
  if (!activities.length) return null
  return (
    <ul className="space-y-2 text-[13px] leading-5">
      {activities.map((activity) => (
        <li key={activity.id}>{activity.label}</li>
      ))}
    </ul>
  )
}
export function DesktopFeedback({
  issue,
  onRefresh,
}: {
  issue: DesktopIssue
  onRefresh?: () => void
}) {
  return (
    <div className="space-y-3">
      <OperationFeedback
        title={
          issue.code === "unavailable"
            ? "当前环境不可用"
            : issue.code === "unknown"
              ? "操作结果待核对"
              : "操作未完成"
        }
        message={issue.message}
        severity={issue.code === "unavailable" ? "info" : "warning"}
        notify={false}
        actions={
          onRefresh && issue.recovery !== "none" ? (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              重新读取状态
            </Button>
          ) : undefined
        }
      />
      <ActivityList activities={issue.activities} />
    </div>
  )
}
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
