import { Sparkles, FileText, Image, LoaderCircle, X } from "lucide-react"
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { useMaterialThumbnail } from "@/features/materials/use-material-thumbnail"
import type { Material } from "./home-types"

export function MaterialChip({
  material,
  onRemove,
  onPreview,
  cwd = "",
}: {
  material: Material
  onRemove: (id: string) => void
  onPreview?: (material: Material) => void
  cwd?: string
}) {
  const { target, thumbnail } = useMaterialThumbnail(material.id, cwd, material.type === "image" && material.status === "ready")
  const state = material.status === "preparing" ? "processing" : material.status === "failed" ? "error" : "done"
  return (
    <Attachment ref={target} size="xs" state={state} className="max-w-[280px] min-w-0 pr-7" title={`${material.name}\n${material.source ?? ""}`}>
      <AttachmentMedia variant={thumbnail || material.thumbnail ? "image" : "icon"}>
        {state === "processing" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : thumbnail || material.thumbnail ? <img src={thumbnail || material.thumbnail} alt={material.name} /> : material.kind === "Skill" ? <Sparkles /> : material.type === "image" ? <Image /> : <FileText />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{material.name}</AttachmentTitle>
        <AttachmentDescription>{material.error || (state === "processing" ? "正在准备…" : material.description || material.source || (material.kind === "Skill" ? "Skill 指令" : "文件引用"))}</AttachmentDescription>
      </AttachmentContent>
      {onPreview && state === "done" && <AttachmentTrigger aria-label={`预览 ${material.name}`} onClick={() => onPreview(material)} />}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`移除${material.name}`}
        className="absolute top-1.5 right-1 z-10"
        onClick={() => onRemove(material.id)}
      >
        <X />
      </Button>
    </Attachment>
  )
}
