import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Checkbox } from "./checkbox"
function Example({ disabled = false }: { disabled?: boolean }) {
  const [checked, setChecked] = useState(true)
  return (
    <label className="flex items-center gap-3 p-6">
      <Checkbox
        disabled={disabled}
        checked={checked}
        onCheckedChange={(value) => setChecked(value === true)}
      />
      <span>{checked ? "已选择" : "未选择"}</span>
    </label>
  )
}
export default {
  id: "checkbox",
  name: "Checkbox",
  layer: "基础组件",
  group: "表单",
  source: "src/components/ui/checkbox.tsx",
  description: "独立选择，可表达多选。",
  boundary: "标签由调用方提供；不执行业务动作。",
  inputs: ["checked、disabled。"],
  events: ["onCheckedChange(boolean | indeterminate)。"],
  composition: ["Radix Checkbox", "Lucide Check"],
  consumers: ["ToolPicker"],
  viewport: { width: 360, height: 220 },
  states: [
    {
      id: "toggle",
      name: "选择与取消",
      condition: "默认选中。",
      expected: "点击整行或 Space 切换勾选，蓝色与勾同时表达选中。",
      render: () => <Example />,
    },
    {
      id: "disabled",
      name: "禁用",
      condition: "disabled=true。",
      expected: "不响应输入，状态保留。",
      render: () => <Example disabled />,
    },
  ],
} satisfies CatalogEntry
