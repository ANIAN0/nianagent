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
  DialogBody,
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
      : null
  )
  const [result, setResult] = useState<{
    key: string
    service: typeof service
    data?: Preview
    issue?: FeedbackDescription
  }>()
  const [revision, setRevision] = useState(0)
  const id = material?.id
  const key = `${cwd}:${id}`
  useEffect(() => {
    if (!id || !service) return
    const controller = new AbortController()
    void service
      .preview(cwd, id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, service, data })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            service,
            issue: feedbackFromError(error, "材料暂时无法读取，请重新读取。"),
          })
      })
    return () => controller.abort()
  }, [service, cwd, id, key, revision])
  const current =
    result?.key === key && result.service === service ? result : undefined
  const label =
    material?.type === "image"
      ? history
        ? "发送时的图片"
        : "待发送图片"
      : material?.type === "skill"
        ? "本次 Skill 内容"
        : material?.type === "directory"
          ? "当前目录"
          : "当前文件"
  const image = material?.type === "image"
  const feedback = !service ? (
    <p className="text-sm text-muted-foreground">
      展示环境未连接真实材料服务。
    </p>
  ) : current?.issue ? (
    <OperationFeedback
      title={
        current.issue.code === "cancelled" ? "预览读取已取消" : "无法读取材料"
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
    <p role="status" className="py-8 text-center text-sm text-muted-foreground">
      正在读取材料…
    </p>
  ) : null
  return (
    <Dialog
      open={!!material}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        variant={image ? "image-preview" : "reader"}
        onClick={(event) => {
          // The transparent viewport stage is also the dismiss area. Image,
          // recovery surface and close button remain independent interactions.
          if (
            image &&
            event.target instanceof Element &&
            !event.target.closest(
              "img, [data-slot=dialog-feedback], [data-slot=dialog-close]"
            )
          )
            onClose()
        }}
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
        <DialogHeader className={image ? "sr-only" : "moon-scrollbar min-w-0"}>
          <DialogTitle>{material?.name ?? "材料预览"}</DialogTitle>
          <DialogDescription>
            {label} · {material?.source ?? material?.description}
          </DialogDescription>
        </DialogHeader>
        <DialogBody
          variant={image ? "image-preview" : "document"}
          className="flex-1"
        >
          {feedback ? (
            image ? (
              <DialogBody variant="feedback">{feedback}</DialogBody>
            ) : (
              feedback
            )
          ) : image && current?.data ? (
            <MaterialImagePreview
              key={`${current.data.mimeType}:${current.data.data}`}
              mimeType={current.data.mimeType}
              data={current.data.data}
              name={current.data.name}
            />
          ) : current?.data ? (
            <pre className="font-sans whitespace-pre-wrap">
              {current.data.content}
            </pre>
          ) : null}
        </DialogBody>
        {current?.data?.truncated && (
          <p className="shrink-0 border-t px-4 py-3 text-xs text-muted-foreground">
            已读取前128KiB，此处不是全文。
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
