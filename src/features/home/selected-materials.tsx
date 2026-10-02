import { MaterialChip } from "./material-chip"
import { InputGroupAddon } from "@/components/ui/input-group"
import type { Material } from "./home-types"
export type SelectedMaterialsProps = {
  materials: Material[]
  onRemove: (id: string) => void
}
export function SelectedMaterials({
  materials,
  onRemove,
}: SelectedMaterialsProps) {
  if (!materials.length) return null
  return (
    <InputGroupAddon align="block-start" className="flex-wrap px-4 pt-3">
      {materials.map((item) => (
        <MaterialChip key={item.id} material={item} onRemove={onRemove} />
      ))}
    </InputGroupAddon>
  )
}
