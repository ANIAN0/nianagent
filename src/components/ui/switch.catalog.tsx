import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Switch } from "./switch"
import { useState } from "react"
function Example({ disabled = false }: { disabled?: boolean }) {
  const [checked, setChecked] = useState(true)
  return (
    <div className="flex items-center gap-3 p-6">
      <Switch
        aria-label="演示开关"
        checked={checked}
        onCheckedChange={setChecked}
        disabled={disabled}
      />
      <p role="status">{checked ? "开启" : "关闭"}</p>
    </div>
  )
}
export default {
  id: "switch",
  name: "Switch",
  layer: "基础组件",
  group: "表单",
  source: "src/components/ui/switch.tsx",
  description: "布尔开关。",
  boundary: "值由调用方持有；必须提供可访问标签。",
  inputs: ["checked、disabled、id。"],
  events: ["onCheckedChange(boolean)。"],
  composition: ["Radix Switch"],
  consumers: ["通用布尔设置，当前首页未使用"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "toggle",
      name: "开关切换",
      condition: "初始开启。",
      expected: "鼠标/Space 切换输出。",
      render: () => <Example />,
    },
    {
      id: "disabled",
      name: "禁用开关",
      condition: "disabled=true。",
      expected: "保持开启，不响应切换。",
      render: () => <Example disabled />,
    },
  ],
} satisfies CatalogEntry
