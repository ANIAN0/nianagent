import { HoverHint } from "@/components/feedback/hover-hint"
import { Image, ImageOff, LoaderCircle } from "lucide-react"
import type { MaterialThumbnailStatus } from "./use-material-thumbnail"
import "./material-thumbnail.css"

/** Status presentation shared by real history cards and their catalog states. */
export function MaterialThumbnail({
  name,
  status,
  url,
  onError,
}: {
  name: string
  status: MaterialThumbnailStatus
  url?: string
  onError?: () => void
}) {
  return status === "ready" && url ? (
    <img
      src={url}
      alt={name}
      className="size-full object-cover"
      onError={onError}
    />
  ) : (
    <HoverHint
      content={
        status === "failed" ? "缩略图加载失败，点击卡片预览图片" : undefined
      }
      label={
        status === "failed"
          ? `${name} 缩略图加载失败，点击卡片预览图片`
          : status === "loading"
            ? `正在加载 ${name} 缩略图`
            : `${name} 缩略图尚未加载`
      }
    >
      <span
        className="material-thumbnail-placeholder"
        data-status={status}
        role={
          status === "loading" || status === "failed" ? "status" : undefined
        }
        aria-label={
          status === "failed"
            ? `${name} 缩略图加载失败，点击卡片预览图片`
            : status === "loading"
              ? `正在加载 ${name} 缩略图`
              : `${name} 缩略图尚未加载`
        }
      >
        {status === "failed" ? (
          <ImageOff aria-hidden />
        ) : status === "loading" ? (
          <LoaderCircle className="animate-spin" aria-hidden />
        ) : (
          <Image aria-hidden />
        )}
        {status !== "idle" && (
          <span>{status === "failed" ? "加载失败" : "加载中"}</span>
        )}
      </span>
    </HoverHint>
  )
}
