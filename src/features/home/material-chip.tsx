import { HoverHint } from "@/components/feedback/hover-hint"
import { FileText, Image, LoaderCircle, RotateCcw, X } from "lucide-react"
import { useId } from "react"
import {
  Attachment,
  AttachmentActions,
  AttachmentAction,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { useMaterialThumbnail } from "@/features/materials/use-material-thumbnail"
import { MaterialThumbnail } from "@/features/materials/material-thumbnail"
import type { Material } from "./home-types"

export type MaterialChipProps = {
  material: Material
  onRemove: (id: string) => void
  onPreview?: (material: Material) => void
  onRetry?: (id: string) => void
  retryLabel?: string
  cwd?: string
}

export function MaterialChip({
  material,
  onRemove,
  onPreview,
  onRetry,
  retryLabel = "重新检查",
  cwd = "",
}: MaterialChipProps) {
  const descriptionId = useId()
  const image = material.type === "image"
  const skill = material.kind === "Skill"
  const {
    target,
    thumbnail,
    status: thumbnailStatus,
    fail: failThumbnail,
  } = useMaterialThumbnail(
    material.id,
    cwd,
    image && material.status === "ready"
  )
  const state =
    material.status === "preparing"
      ? "processing"
      : material.status === "failed"
        ? "error"
        : "done"
  const retry = state === "error" && material.retryable !== false && onRetry
  const open = state === "done" && onPreview
  const sourceDescription = material.description || material.source
  const fileSourceDescription =
    material.type === "file"
      ? sourceDescription?.replaceAll("\\", "/")
      : sourceDescription
  const fileDescription =
    material.type === "file" && fileSourceDescription === material.name
      ? "文件引用"
      : material.type === "file" &&
          fileSourceDescription?.endsWith(`/${material.name}`) &&
          !/^[a-zA-Z]:\//.test(fileSourceDescription) &&
          !fileSourceDescription.startsWith("/")
        ? fileSourceDescription.slice(0, -material.name.length - 1) ||
          "文件引用"
        : sourceDescription
  const description =
    state === "processing"
      ? "正在准备…"
      : state === "error"
        ? retry
          ? `准备失败 · ${retryLabel}`
          : material.error || "准备失败，请重新选择或移除。"
        : material.presentation === "attachment" && !image
          ? material.bytes !== undefined
            ? `${material.bytes < 1024 ? `${material.bytes} B` : `${(material.bytes / 1024).toFixed(1)} KB`} · 文件路径引用`
            : "文件路径引用"
          : fileDescription || (skill ? "Skill 指令" : "文件引用")
  const label = retry
    ? `${retryLabel} ${material.name}`
    : `预览 ${material.name}`
  return (
    <HoverHint
      content={`${material.name}\n${material.error || material.source || description}`}
    >
      <Attachment
        ref={target}
        size={skill ? "xs" : "default"}
        orientation={image ? "vertical" : "horizontal"}
        state={state}
        className={
          image
            ? "size-16 max-w-16 min-w-16 gap-0 p-0!"
            : skill
              ? "max-w-[240px] min-w-0 rounded-md border-primary/15 bg-primary/10 py-1 pr-7! pl-2! text-primary has-[>a,>button]:hover:bg-primary/15"
              : "h-16 max-w-[240px] min-w-40 flex-nowrap pr-9!"
        }
      >
        {!skill && (
          <AttachmentMedia
            variant={image ? "image" : "icon"}
            className={image ? "size-full rounded-[inherit]" : undefined}
          >
            {state === "processing" ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : image && state === "done" ? (
              <MaterialThumbnail
                name={material.name}
                url={thumbnail || material.thumbnail}
                status={
                  (thumbnail || material.thumbnail) &&
                  thumbnailStatus !== "failed"
                    ? "ready"
                    : thumbnailStatus
                }
                onError={failThumbnail}
              />
            ) : image && retry ? (
              <div className="flex flex-col items-center gap-1">
                <RotateCcw />
                <span className="text-[10px] leading-3">{retryLabel}</span>
              </div>
            ) : image ? (
              <Image />
            ) : (
              <FileText />
            )}
          </AttachmentMedia>
        )}
        {skill && state === "processing" && (
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
        )}
        {skill && retry && <RotateCcw className="size-3.5" />}
        <AttachmentContent className={image ? "sr-only" : undefined}>
          <AttachmentTitle>
            {skill ? `/${material.name.replace(/^\//, "")}` : material.name}
          </AttachmentTitle>
          <AttachmentDescription
            id={descriptionId}
            className={
              skill && state === "done"
                ? "sr-only"
                : state === "done"
                  ? "text-muted-foreground"
                  : undefined
            }
          >
            {description}
            {retry && material.error && (
              <span className="sr-only">。{material.error}</span>
            )}
          </AttachmentDescription>
        </AttachmentContent>
        {(retry || open) && (
          <AttachmentTrigger
            aria-label={label}
            aria-describedby={descriptionId}
            onClick={() => {
              if (retry) onRetry?.(material.id)
              else onPreview?.(material)
            }}
          />
        )}
        <AttachmentActions
          placement={skill ? "default" : "corner"}
          className={
            skill ? "absolute top-1/2 right-1 -translate-y-1/2" : undefined
          }
        >
          <HoverHint content={`移除${material.name}`}>
            <AttachmentAction
              aria-label={`移除${material.name}`}
              appearance={skill ? "default" : "overlay"}
              className={
                skill ? "size-5 text-caption hover:text-foreground" : undefined
              }
              onClick={() => onRemove(material.id)}
            >
              <X />
            </AttachmentAction>
          </HoverHint>
        </AttachmentActions>
      </Attachment>
    </HoverHint>
  )
}
