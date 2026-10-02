import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Input } from "./input"
import { useState } from "react"
function Example({
  disabled = false,
  invalid = false,
}: {
  disabled?: boolean
  invalid?: boolean
}) {
  const [value, setValue] = useState("")
  return (
    <div className="p-6">
      <Input
        aria-label="演示Input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        aria-invalid={invalid}
        placeholder="请输入内容"
      />
      <p role="status">文本：{value}</p>
    </div>
  )
}
export default {
  id: "input",
  name: "Input",
  layer: "基础组件",
  group: "表单",
  source: "src/components/ui/input.tsx",
  description: "原生单行输入的统一外观。",
  boundary: "输入状态由调用方持有，需 label 或 aria-label。",
  inputs: ["value、disabled、aria-invalid、placeholder。"],
  events: ["onChange(event)、原生键盘事件。"],
  composition: ["原生 input"],
  consumers: ["InputGroupInput"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "editing",
      name: "输入与焦点",
      condition: "空文本。",
      expected: "真实输入及焦点样式正常。",
      render: () => <Example />,
    },
    {
      id: "disabled",
      name: "禁用输入",
      condition: "disabled=true。",
      expected: "不可编辑。",
      render: () => <Example disabled />,
    },
    {
      id: "invalid",
      name: "无效输入",
      condition: "aria-invalid=true。",
      expected: "显示错误边框，仍可编辑。",
      render: () => <Example invalid />,
    },
  ],
} satisfies CatalogEntry
