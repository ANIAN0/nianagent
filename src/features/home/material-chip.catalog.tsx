import { useState } from "react"
import { MaterialChip } from "./material-chip"
import type { Material } from "./home-types"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({ material }: { material: Material }) {
  const [removed, setRemoved] = useState(false)
  return (
    <div className="p-6">
      {removed ? (
        <p role="status">已移除：{material.id}</p>
      ) : (
        <MaterialChip material={material} onRemove={() => setRemoved(true)} />
      )}
    </div>
  )
}
export default {
  id: "material-chip",
  name: "材料条目",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/material-chip.tsx",
  description: "一份附件或 Skill 的身份、名称与移除动作。",
  boundary: "仅表达单个已选材料；集合去重与移除由调用方处理。",
  props: [
    {
      name: "material",
      type: "Material",
      default: "必填",
      description: "id、name、kind（附件或 Skill）。",
    },
    {
      name: "onRemove",
      type: "(id: string) => void",
      default: "必填",
      description: "只通知移除目标，不修改数据。",
    },
  ],
  inputs: ["material: Material"],
  events: ["onRemove(id)"],
  composition: ["Badge", "Button"],
  consumers: ["SelectedMaterials"],
  viewport: { width: 340, height: 160 },
  states: [
    {
      id: "file",
      name: "附件",
      condition: "一个文件材料。",
      expected: "文件图标与名称可见，移除反馈目标 ID。",
      render: () => (
        <Example material={{ id: "readme", name: "README.md", kind: "附件" }} />
      ),
    },
    {
      id: "skill",
      name: "Skill",
      condition: "一个能力材料。",
      expected: "使用 Skill 图标，可独立移除。",
      render: () => (
        <Example material={{ id: "review", name: "代码审查", kind: "Skill" }} />
      ),
    },
    {
      id: "long",
      name: "长名称",
      condition: "超过可用宽度。",
      expected: "截断但移除始终可见，悬停名称显示完整文本。",
      render: () => (
        <Example
          material={{
            id: "long",
            name: "首页交互与组件边界审查记录以及后续修订说明.md",
            kind: "附件",
          }}
        />
      ),
    },
  ],
} satisfies CatalogEntry
