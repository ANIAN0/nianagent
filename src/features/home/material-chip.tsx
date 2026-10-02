import { Sparkles, FileText, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Material } from "./home-types"

export function MaterialChip({
  material,
  onRemove,
}: {
  material: Material
  onRemove: (id: string) => void
}) {
  return (
    <Badge variant="secondary" className="max-w-full gap-1 py-1">
      {material.kind === "Skill" ? <Sparkles /> : <FileText />}
      <span className="truncate" title={material.name}>
        {material.name}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`移除${material.name}`}
        onClick={() => onRemove(material.id)}
      >
        <X />
      </Button>
    </Badge>
  )
}
