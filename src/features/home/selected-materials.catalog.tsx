import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { SelectedMaterials } from "./selected-materials"
import { homeData } from "../../../ui-catalog/fixtures/home"
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group"

function Example({ empty = false }: { empty?: boolean }) {
  const [items, setItems] = useState(
    empty
      ? []
      : [
          ...homeData.materials,
          {
            id: "long",
            name: "这是一个很长的附件名称用于检查窄屏截断和移除按钮.md",
            kind: "附件" as const,
          },
        ]
  )
  return (
    <div className="p-6">
      <InputGroup>
        <InputGroupTextarea
          aria-label="材料所属输入区"
          placeholder="材料所属输入区"
        />
        <SelectedMaterials
          materials={items}
          onRemove={(id) =>
            setItems((current) => current.filter((item) => item.id !== id))
          }
        />
      </InputGroup>
      <p role="status">材料数：{items.length}</p>
    </div>
  )
}
export default {
  id: "selected-materials",
  name: "已选材料",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/selected-materials.tsx",
  description: "展示附件和 Skill 标签并发出移除事件。",
  boundary:
    "材料由草稿持有；嵌入InputGroup，空集合不占空间。正式页面通过材料服务准备和预览，目录没有生产连接。",
  inputs: ["materials: Material[]。"],
  events: ["onRemove(id)：父级移除该材料。"],
  composition: ["InputGroupAddon", "MaterialChip", "MaterialPreviewDialog"],
  consumers: ["HomeComposer", "ConversationComposer"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "populated",
      name: "材料与长名称",
      condition: "附件、Skill 及长名称。",
      expected: "可逐项移除，长名不挤出移除按钮。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "无已选材料",
      condition: "空集合。",
      expected: "不显示材料区域。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
