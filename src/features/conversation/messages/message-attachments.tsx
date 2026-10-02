import { useRef, useState } from "react"
import { FileText, Image, ImageOff } from "lucide-react"
import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type { MessageAttachment } from "../conversation-types"
import "./messages.css"

export function MessageAttachments({
  attachments,
  onOpenAttachment,
}: {
  attachments: MessageAttachment[]
  onOpenAttachment?: (attachment: MessageAttachment) => void
}) {
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [active, setActive] = useState<MessageAttachment | null>(null)
  if (!attachments.length) return null
  return (
    <>
      <div
        className="conversation-message-attachments"
        data-compact={attachments.length > 1}
      >
        {attachments.map((attachment) => (
          <Attachment
            key={attachment.id}
            state="done"
            data-kind={attachment.kind}
            title={attachment.name}
          >
            <AttachmentMedia
              variant={
                attachment.kind === "image" && attachment.url ? "image" : "icon"
              }
            >
              {attachment.kind === "image" && attachment.url ? (
                <AttachmentImage
                  key={attachment.url}
                  url={attachment.url}
                  name={attachment.name}
                />
              ) : attachment.kind === "image" ? (
                <Image />
              ) : (
                <FileText />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{attachment.name}</AttachmentTitle>
              <AttachmentDescription>
                {attachment.name.includes(".")
                  ? attachment.name.split(".").at(-1)?.toUpperCase().slice(0, 8)
                  : "文件"}
                {attachment.bytes !== undefined &&
                  ` · ${attachment.bytes < 1024 ? `${attachment.bytes} B` : `${(attachment.bytes / 1024).toFixed(1)} KB`}`}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentTrigger
              aria-label={`预览 ${attachment.name}`}
              onClick={(event) => {
                trigger.current = event.currentTarget
                setActive(attachment)
                onOpenAttachment?.(attachment)
              }}
            />
          </Attachment>
        ))}
      </div>
      <Dialog
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) setActive(null)
        }}
      >
        <DialogContent
          className="conversation-attachment-preview"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            trigger.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{active?.name ?? "附件预览"}</DialogTitle>
            <DialogDescription>
              {active?.kind === "image" ? "图片预览" : "文件内容预览"}
            </DialogDescription>
          </DialogHeader>
          {active?.kind === "image" && active.url ? (
            <AttachmentImage
              key={active.url}
              url={active.url}
              name={active.name}
            />
          ) : active?.content !== undefined ? (
            <pre>{active.content}</pre>
          ) : (
            <p>此附件仅记录了名称，尚无可预览的内容。</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function AttachmentImage({ url, name }: { url: string; name: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading"
  )
  return (
    <>
      {status === "loading" && (
        <span className="conversation-image-status" role="status">
          图片加载中…
        </span>
      )}
      {status === "failed" && (
        <span className="conversation-image-status" role="status">
          <ImageOff aria-hidden />
          图片加载失败
        </span>
      )}
      <img
        src={url}
        alt={name}
        onLoad={() => setStatus("ready")}
        onError={() => setStatus("failed")}
        hidden={status !== "ready"}
      />
    </>
  )
}
