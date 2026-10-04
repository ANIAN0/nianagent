import { useContext, useEffect, useState } from "react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type { MaterialPreview as Preview } from "@/features/models/model-contract.generated"
import type { Material } from "@/features/home/home-types"
import { MaterialServiceContext } from "./material-service"
import { MaterialImagePreview } from "./material-image-preview"

type MaterialPreviewProps = {
  material: Material | null
  cwd: string
  history?: boolean
  onClose: () => void
}
export function MaterialPreviewDialog(props: MaterialPreviewProps) {
  // A new opening reads current files afresh; a prior opening is never presented
  // as the current disk contents while the next request is still pending.
  return props.material ? (
    <MaterialPreviewContent
      key={`${props.cwd}:${props.material.id}:${props.history}`}
      {...props}
    />
  ) : null
}
function MaterialPreviewContent({
  material,
  cwd,
  history = false,
  onClose,
}: MaterialPreviewProps) {
  const service = useContext(MaterialServiceContext)
  const [returnFocus] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )
  const [result, setResult] = useState<{
    key: string
    data?: Preview
    issue?: FeedbackDescription
  }>()
  const [revision, setRevision] = useState(0)
  const key = `${cwd}:${material?.id}`
  useEffect(() => {
    if (!material || !service) return
    const controller = new AbortController()
    void service
      .preview(cwd, material.id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            issue: feedbackFromError(error, "材料暂时无法读取，请重新读取。"),
          })
      })
    return () => controller.abort()
  }, [service, cwd, material, key, revision])
  const current = result?.key === key ? result : undefined
  const label =
    material?.type === "image"
      ? history
        ? "发送时的图片"
        : "待发送图片"
      : material?.type === "skill"
        ? "本次 Skill 内容"
        : "当前文件"
  return (
    <Dialog
      open={!!material}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] w-[calc(100vw-32px)] max-w-[760px] flex-col sm:max-w-[760px]"
        onCloseAutoFocus={(event) => {
          if (returnFocus) {
            event.preventDefault()
            if (
              returnFocus.isConnected &&
              returnFocus.getClientRects().length > 0 &&
              !returnFocus.matches(":disabled")
            )
              returnFocus.focus()
          }
        }}
      >
        <DialogHeader className="min-w-0 shrink-0 pr-6">
          <DialogTitle className="leading-6 [overflow-wrap:anywhere]">
            {material?.name ?? "材料预览"}
          </DialogTitle>
          <DialogDescription className="break-all">
            {label} · {material?.source ?? material?.description}
          </DialogDescription>
        </DialogHeader>
        <div className="moon-scrollbar min-h-0 min-w-0 flex-1 overflow-auto">
          {!service ? (
            <p className="text-sm text-muted-foreground">
              展示环境未连接真实材料服务。
            </p>
          ) : current?.issue ? (
            <OperationFeedback
              title={
                current.issue.code === "cancelled"
                  ? "预览读取已取消"
                  : "无法读取材料"
              }
              {...current.issue}
              actions={
                <RecoveryAction
                  issue={current.issue}
                  onRetry={() => {
                    setResult(undefined)
                    setRevision((value) => value + 1)
                  }}
                  onReload={() => {
                    setResult(undefined)
                    setRevision((value) => value + 1)
                  }}
                  onCheck={() => {
                    setResult(undefined)
                    setRevision((value) => value + 1)
                  }}
                  labels={{ retry: "重新读取" }}
                />
              }
            />
          ) : !current?.data ? (
            <p
              role="status"
              className="py-8 text-center text-sm text-muted-foreground"
            >
              正在读取材料…
            </p>
          ) : material?.type === "image" ? (
            <MaterialImagePreview
              key={`${current.data.mimeType}:${current.data.data}`}
              mimeType={current.data.mimeType}
              data={current.data.data}
              name={current.data.name}
            />
          ) : (
            <pre className="text-sm leading-6 break-words whitespace-pre-wrap">
              {current.data.content}
            </pre>
          )}
        </div>
        {current?.data?.truncated && (
          <p className="shrink-0 text-xs text-muted-foreground">
            已读取前128KiB，此处不是全文。
          </p>
        )}
        {material?.type === "file" && (
          <p className="shrink-0 text-xs text-muted-foreground">
            展示磁盘当前内容，文件引用不代表 Agent 已经读取。
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
