import { MaterialChip } from "./material-chip"
import { InputGroupAddon } from "@/components/ui/input-group"
import type { Material } from "./home-types"
import { useState } from "react"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
export type SelectedMaterialsProps = {
  materials: Material[]
  onRemove: (id: string) => void
  cwd?: string
}
export function SelectedMaterials({
  materials,
  onRemove,
  cwd = "",
}: SelectedMaterialsProps) {
  const [active, setActive] = useState<Material | null>(null)
  if (!materials.length) return null
  return (
    <>
    <InputGroupAddon align="block-start" className="flex-wrap gap-2 px-4 pt-3">
      {materials.map((item) => (
        <MaterialChip key={item.id} material={item} cwd={cwd} onRemove={onRemove} onPreview={setActive} />
      ))}
    </InputGroupAddon>
    <MaterialPreviewDialog material={active} cwd={cwd} onClose={() => setActive(null)} />
    </>
  )
}
