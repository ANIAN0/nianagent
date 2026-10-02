import type { CatalogEntry } from "../../../ui-catalog/catalog"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "./select"
import { useState } from "react"
function Example({
  disabled = false,
  variant = "default",
}: {
  disabled?: boolean
  variant?: "default" | "ghost"
}) {
  const [value, setValue] = useState("")
  return (
    <div className="p-6">
      <Select value={value} onValueChange={setValue} disabled={disabled}>
        <SelectTrigger aria-label="演示选择" variant={variant}>
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="one">选项一</SelectItem>
            <SelectItem value="two">选项二</SelectItem>
            <SelectItem value="three" disabled>
              不可选项
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <p role="status">当前：{value || "未选择"}</p>
    </div>
  )
}
export default {
  id: "select",
  name: "Select",
  layer: "基础组件",
  group: "表单",
  source: "src/components/ui/select.tsx",
  description: "单项选择控件。",
  boundary: "选项 value 非空且唯一；通过受控值对接业务。",
  inputs: ["value、disabled；SelectTrigger.size、variant(default/ghost)。"],
  events: ["onValueChange(value)。"],
  composition: ["Radix Select"],
  consumers: ["ModelPicker", "ThinkingPicker"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "ghost",
      name: "工具栏选择",
      condition: "variant=ghost。",
      expected: "无输入边框，悬停和聚焦仍明确，选择行为与默认相同。",
      render: () => <Example variant="ghost" />,
    },
    {
      id: "available",
      name: "选择与占位",
      condition: "未选择，含禁用项。",
      expected: "占位、键盘与鼠标选择正常。",
      render: () => <Example />,
    },
    {
      id: "disabled",
      name: "禁用选择",
      condition: "disabled=true。",
      expected: "无法打开选择列表。",
      render: () => <Example disabled />,
    },
  ],
} satisfies CatalogEntry
