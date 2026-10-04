import { useState } from "react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"

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
    "loading",
  )
  const supported = /^image\/(?:png|jpeg|gif|webp)$/i.test(mimeType)
  const failed = !supported || !data || status === "failed"
  return (
    <div className="material-image-preview">
      {failed ? (
        <OperationFeedback
          title="无法显示图片"
          message="图片内容无法解码，请重新选择有效图片。"
          severity="warning"
        />
      ) : (
        <>
          {status === "loading" && (
            <p
              role="status"
              className="py-8 text-center text-sm text-muted-foreground"
            >
              正在加载图片…
            </p>
          )}
          <img
            src={`data:${mimeType};base64,${data}`}
            alt={name}
            className="mx-auto max-h-[65dvh] max-w-full rounded-lg object-contain"
            hidden={status !== "ready"}
            onLoad={() => setStatus("ready")}
            onError={() => setStatus("failed")}
          />
        </>
      )}
    </div>
  )
}
