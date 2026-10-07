import { File } from "lucide-react"
import { MaterialThumbnail } from "@/features/materials/material-thumbnail"
import { useMaterialThumbnail } from "@/features/materials/use-material-thumbnail"
import type { Material } from "@/features/home/home-types"

function QueueAttachment({
  material,
  cwd,
}: {
  material: Material
  cwd: string
}) {
  const image = material.type === "image"
  const { target, thumbnail, status, fail } = useMaterialThumbnail(
    material.id,
    cwd,
    image && !material.thumbnail
  )
  return image ? (
    <div ref={target} className="conversation-queue-image">
      <MaterialThumbnail
        name={material.name}
        status={material.thumbnail ? "ready" : status}
        url={material.thumbnail || thumbnail}
        onError={fail}
      />
    </div>
  ) : (
    <span
      className="conversation-queue-file"
      aria-label={material.name}
      title={material.name}
    >
      <File className="conversation-queue-file-icon" />
      <span className="conversation-queue-file-name">{material.name}</span>
      {material.bytes !== undefined && (
        <span className="conversation-queue-file-size">
          {material.bytes < 1024
            ? `${material.bytes} B`
            : material.bytes < 1024 * 1024
              ? `${(material.bytes / 1024).toFixed(1)} KB`
              : `${(material.bytes / (1024 * 1024)).toFixed(1)} MB`}
        </span>
      )}
    </span>
  )
}

/** Durable attachments keep the same 24px identity strip as DSH queue rows. */
export function QueueAttachments({
  materials,
  cwd,
}: {
  materials: Material[]
  cwd: string
}) {
  if (!materials.length) return null
  return (
    <div className="conversation-queue-attachments">
      {materials.map((material) => (
        <QueueAttachment key={material.id} material={material} cwd={cwd} />
      ))}
    </div>
  )
}
