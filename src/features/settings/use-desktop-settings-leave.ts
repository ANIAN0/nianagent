import { useCallback, useEffect, useState } from "react"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import { notifyToast } from "@/components/ui/notification-toast"

export function useDesktopSettingsLeave(
  registerLeave: ((guard: LeaveGuard | null) => void) | undefined,
  state: "busy" | "unknown" | "draft" | "ready"
) {
  const [discard, setDiscard] = useState<() => void>()
  const leave = useCallback<LeaveGuard>(
    (action) => {
      if (state === "busy") {
        notifyToast("正在提交或读取桌面操作，请稍候。", { tone: "info" })
      } else if (state === "unknown") {
        notifyToast("请先重新读取状态，核对原操作结果。", { tone: "warning" })
      } else if (state === "draft") {
        setDiscard(() => action)
      } else {
        action()
      }
    },
    [state]
  )
  useEffect(() => {
    registerLeave?.(leave)
    return () => registerLeave?.(null)
  }, [leave, registerLeave])
  return { leave, discard, cancelDiscard: () => setDiscard(undefined) }
}
