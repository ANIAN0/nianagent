import { useState } from "react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { DialogBody } from "@/components/ui/dialog"

/** Decode failure is distinct from a retryable host preview request failure. */
export function MaterialImagePreview({
  name,
  mimeType,
  data,
}: {
  name: string
  mimeType: string
  data: string
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading"
  )
  const supported = /^image\/(?:png|jpeg|gif|webp)$/i.test(mimeType)
  const failed = !supported || !data || status === "failed"
  return (
    <div className="flex size-full min-h-0 min-w-0 items-center justify-center">
      {failed ? (
        <DialogBody variant="feedback">
          <OperationFeedback
            notify={false}
            title="无法显示图片"
            message="图片内容无法解码，请重新选择有效图片。"
            severity="warning"
          />
        </DialogBody>
      ) : (
        <>
          {status === "loading" && (
            <DialogBody variant="feedback">
              <p
                role="status"
                className="py-8 text-center text-sm text-muted-foreground"
              >
                正在加载图片…
              </p>
            </DialogBody>
          )}
          <img
            src={`data:${mimeType};base64,${data}`}
            alt={name}
            className="max-h-full max-w-full object-contain"
            hidden={status !== "ready"}
            onLoad={() => setStatus("ready")}
            onError={() => setStatus("failed")}
          />
        </>
      )}
    </div>
  )
}
