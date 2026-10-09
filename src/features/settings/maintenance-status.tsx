import { useState } from "react"
import type { MaintenancePhase } from "@/contracts/desktop.generated"
import { Button } from "@/components/ui/button"
import { useDesktopService, useDesktopView } from "./desktop-service"
import { DesktopFeedback, desktopIssue } from "./settings-feedback"
import type { DesktopIssue } from "@/contracts/desktop.generated"
const labels: Record<MaintenancePhase, string> = {
  idle: "",
  preparing: "正在预检维护条件…",
  flushing: "正在保存草稿和恢复记录…",
  closing: "正在结束运行服务…",
  waitingForExit: "正在等待程序与浏览器数据释放…",
  copying: "正在复制数据…",
  validating: "正在验证数据…",
  committing: "正在启用新目录…",
  handedOff: "已交接维护，请等待 Moon 重启",
  succeeded: "维护已完成",
  failed: "维护未完成",
  unknown: "维护结果待核对",
}
export function MaintenanceStatus() {
  const service = useDesktopService()
  const { snapshot } = useDesktopView()
  const [issue, setIssue] = useState<DesktopIssue | null>(null)
  const [busy, setBusy] = useState(false)
  const state = snapshot?.maintenance
  if (!state || state.kind === "none" || state.phase === "idle") return null
  const restart =
    state.shutdownStarted && ["failed", "unknown"].includes(state.phase)
  return (
    <aside
      className="shrink-0 space-y-2 border-b bg-muted/40 px-4 py-3 text-[13px]"
      aria-label="桌面维护状态"
    >
      <p role="status">
        {state.kind === "migration" ? "数据迁移" : "版本更新"} ·{" "}
        {labels[state.phase]}
        {state.totalFiles > 0
          ? ` ${state.completedFiles}/${state.totalFiles}`
          : ""}
      </p>
      {state.writesFrozen && (
        <p className="text-muted-foreground">
          维护期间暂停新变更，现有内容和原请求身份保留。
        </p>
      )}
      {state.issue && (
        <DesktopFeedback
          issue={state.issue}
          onRefresh={() => void service.refresh()}
        />
      )}
      {issue && <DesktopFeedback issue={issue} />}
      {restart && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void service.call("desktop_restart", undefined).catch((error) => {
              setIssue(desktopIssue(error))
              setBusy(false)
            })
          }}
        >
          {busy ? "正在重启…" : "重启并恢复"}
        </Button>
      )}
    </aside>
  )
}
