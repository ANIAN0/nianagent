import { useState } from "react"
import { Copy, Download, FolderOpen } from "lucide-react"
import type {
  DesktopIssue,
  DesktopSnapshot,
} from "@/contracts/desktop.generated"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useDesktopService } from "./desktop-service"
import { DesktopFeedback, desktopIssue } from "./settings-feedback"

function diagnosticsText(snapshot: DesktopSnapshot) {
  return [
    "moon 桌面诊断",
    `版本：${snapshot.version}`,
    `平台：${snapshot.platform} / ${snapshot.architecture}`,
    `开发模式：${snapshot.development ? "是" : "否"}`,
    `存储来源：${snapshot.storage.source}`,
    `存储版本：${snapshot.storage.schemaVersion}`,
    `维护状态：${snapshot.maintenance.kind} / ${snapshot.maintenance.phase}`,
    `更新状态：${snapshot.update.phase}`,
    `维护错误代码：${snapshot.maintenance.issue?.code ?? "无"}`,
    `更新错误代码：${snapshot.update.issue?.code ?? "无"}`,
  ].join("\n")
}

export function DesktopDiagnostics({
  snapshot,
}: {
  snapshot: DesktopSnapshot
}) {
  const service = useDesktopService()
  const [issue, setIssue] = useState<DesktopIssue>()
  const [status, setStatus] = useState("")
  const [exporting, setExporting] = useState(false)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">桌面诊断</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={!snapshot.capabilities.openDataDirectory}
              onClick={() => {
                setIssue(undefined)
                void service
                  .call("desktop_open_log_directory", undefined)
                  .catch((error) => setIssue(desktopIssue(error)))
              }}
            >
              <FolderOpen data-icon="inline-start" />
              打开日志目录
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                setStatus("")
                void navigator.clipboard
                  .writeText(diagnosticsText(snapshot))
                  .then(() => setStatus("已复制脱敏诊断信息。"))
                  .catch(() => setStatus("无法访问剪贴板，请使用导出。"))
              }}
            >
              <Copy data-icon="inline-start" />
              复制诊断信息
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={exporting}
              onClick={() => {
                setIssue(undefined)
                setStatus("")
                setExporting(true)
                void service
                  .call("desktop_export_diagnostics", undefined)
                  .then((path) => {
                    if (path) setStatus("已保存脱敏诊断文件。")
                  })
                  .catch((error) => setIssue(desktopIssue(error)))
                  .finally(() => setExporting(false))
              }}
            >
              <Download data-icon="inline-start" />
              {exporting ? "正在导出…" : "导出诊断信息"}
            </Button>
          </div>
        </div>
        {status && (
          <p role="status" className="text-xs text-muted-foreground">
            {status}
          </p>
        )}
        {issue && <DesktopFeedback issue={issue} />}
      </CardContent>
    </Card>
  )
}
