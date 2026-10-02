import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { RadioGroup, RadioGroupItem } from "./radio-group"
function Example({
  disabled = false,
  check = false,
}: {
  disabled?: boolean
  check?: boolean
}) {
  return (
    <RadioGroup
      defaultValue="a"
      disabled={disabled}
      aria-label="演示单选"
      className="p-6"
    >
      {["a", "b"].map((value) => (
        <label key={value} className="flex items-center gap-3">
          <RadioGroupItem value={value} variant={check ? "check" : "circle"} />
          选项 {value.toUpperCase()}
        </label>
      ))}
    </RadioGroup>
  )
}
export default {
  id: "radio-group",
  name: "RadioGroup",
  layer: "基础组件",
  group: "表单",
  source: "src/components/ui/radio-group.tsx",
  description: "一组互斥选项。",
  boundary: "提供组标签与选项标签；选项值由父级控制或 defaultValue 初始化。",
  inputs: [
    "value/defaultValue、disabled；variant=circle（默认）或check（无圆框勾选）。",
  ],
  events: ["onValueChange(value)。"],
  composition: ["Radix RadioGroup"],
  consumers: ["ModelPicker", "ThinkingPicker", "InstructionScopePicker"],
  viewport: { width: 360, height: 250 },
  states: [
    {
      id: "check",
      name: "尾部勾选外观",
      condition: "variant=check。",
      expected: "单选语义不变，选中只显示Lucide Check，未选无圆框。",
      render: () => <Example check />,
    },
    {
      id: "select",
      name: "互斥选择",
      condition: "第一项选中。",
      expected: "点击或方向键切换，只有一项选中。",
      render: () => <Example />,
    },
    {
      id: "disabled",
      name: "整组禁用",
      condition: "disabled=true。",
      expected: "保留选择且不可更改。",
      render: () => <Example disabled />,
    },
  ],
} satisfies CatalogEntry
