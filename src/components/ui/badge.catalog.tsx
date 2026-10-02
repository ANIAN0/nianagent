import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Badge } from "./badge"

export default {
  id: "badge",
  name: "Badge",
  layer: "基础组件",
  group: "反馈",
  source: "src/components/ui/badge.tsx",
  description: "紧凑的标签与状态标识。",
  boundary: "纯展示；需要移除操作时由 MaterialChip 组合按钮。",
  inputs: ["variant、asChild、children。"],
  events: ["沿用原生 span 事件。"],
  composition: ["Radix Slot", "CVA"],
  consumers: ["MaterialChip"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "variants",
      name: "标签变体",
      condition: "六种正式支持的变体。",
      expected: "各标签显示对应外观。",
      render: () => (
        <div className="flex flex-wrap gap-3 p-6">
          {(
            [
              "default",
              "secondary",
              "outline",
              "ghost",
              "destructive",
              "link",
            ] as const
          ).map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
