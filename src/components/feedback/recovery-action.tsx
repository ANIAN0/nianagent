import { Button } from "@/components/ui/button"
import type { FeedbackDescription } from "@/lib/operation-issue"

type RecoveryCommand = "retry" | "reload" | "check" | "settings"
export type RecoveryActionProps = {
  issue: FeedbackDescription
  onRetry?: () => void
  onReload?: () => void
  onCheck?: () => void
  onSettings?: () => void
  disabled?: boolean
  className?: string
  labels?: Partial<Record<RecoveryCommand, string>>
}

/** A recovery names its actual action; a restart never becomes another request. */
export function RecoveryAction({
  issue,
  onRetry,
  onReload,
  onCheck,
  onSettings,
  disabled = false,
  className,
  labels,
}: RecoveryActionProps) {
  const recovery =
    issue.recovery ?? (onRetry ? "retry" : onReload ? "reload" : "none")
  if (recovery === "restart")
    return (
      <span className="text-xs leading-5 text-muted-foreground">
        请退出并重新启动 Moon 桌面应用。
      </span>
    )
  if (recovery === "none") return null
  if (recovery === "settings" && !onSettings)
    return (
      <span className="text-xs leading-5 text-muted-foreground">
        请打开设置检查配置。
      </span>
    )
  const commands = {
    retry: { run: onRetry, label: "重试" },
    reload: { run: onReload, label: "重新读取" },
    check: { run: onCheck, label: "核对状态" },
    settings: { run: onSettings, label: "打开设置" },
  }
  const command = commands[recovery]
  if (!command.run) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={disabled}
      onClick={command.run}
    >
      {labels?.[recovery] ?? command.label}
    </Button>
  )
}
