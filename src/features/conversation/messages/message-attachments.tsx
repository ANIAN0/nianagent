import { useRef, useState } from "react"
import { FileText, ImageOff, Sparkles } from "lucide-react"
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
import { useMaterialThumbnail } from "@/features/materials/use-material-thumbnail"
import { MaterialThumbnail } from "@/features/materials/material-thumbnail"
import { useMessageEnvironment } from "./message-environment"

export function MessageAttachments({
  attachments,
  onOpenAttachment,
  cwd: providedCwd,
}: {
  attachments: MessageAttachment[]
  onOpenAttachment?: (attachment: MessageAttachment) => void
  cwd?: string
}) {
  const environment = useMessageEnvironment()
  const cwd = providedCwd ?? environment?.cwd ?? ""
  const openAttachment = onOpenAttachment ?? environment?.onOpenAttachment
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
            data-material-type={attachment.materialType}
            title={attachment.name}
          >
            <AttachmentMedia
              variant={
                attachment.kind === "image" && (attachment.url || cwd)
                  ? "image"
                  : "icon"
              }
            >
              {attachment.kind === "image" && safeImageUrl(attachment.url) ? (
                <AttachmentImage
                  key={attachment.url}
                  url={attachment.url!}
                  name={attachment.name}
                />
              ) : attachment.kind === "image" ? (
                <PreparedImageThumbnail
                  id={attachment.id}
                  cwd={cwd}
                  name={attachment.name}
                />
              ) : attachment.materialType === "skill" ? (
                <Sparkles />
              ) : (
                <FileText />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{attachment.name}</AttachmentTitle>
              <AttachmentDescription>
                {attachment.materialType === "skill"
                  ? "Skill 指令"
                  : attachment.name.includes(".")
                    ? attachment.name
                        .split(".")
                        .at(-1)
                        ?.toUpperCase()
                        .slice(0, 8)
                    : "文件"}
                {attachment.source && ` · ${attachment.source}`}
                {attachment.bytes !== undefined &&
                  ` · ${attachment.bytes < 1024 ? `${attachment.bytes} B` : `${(attachment.bytes / 1024).toFixed(1)} KB`}`}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentTrigger
              aria-label={`预览 ${attachment.name}`}
              onClick={(event) => {
                trigger.current = event.currentTarget
                if (openAttachment) openAttachment(attachment)
                else setActive(attachment)
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
          {active?.kind === "image" && safeImageUrl(active.url) ? (
            <AttachmentImage
              key={active.url}
              url={active.url!}
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

function safeImageUrl(url?: string) {
  return Boolean(
    url &&
    (url.startsWith("blob:") ||
      (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(url) &&
        url.length <= 2_800_000))
  )
}

function PreparedImageThumbnail({
  id,
  cwd,
  name,
}: {
  id: string
  cwd: string
  name: string
}) {
  const { target, thumbnail, status, fail } = useMaterialThumbnail(
    id,
    cwd,
    !!cwd
  )
  return (
    <div ref={target} className="flex size-full items-center justify-center">
      <MaterialThumbnail
        name={name}
        status={status}
        url={thumbnail}
        onError={fail}
      />
    </div>
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
