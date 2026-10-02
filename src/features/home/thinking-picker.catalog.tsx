import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ThinkingPicker } from "./thinking-picker"

function Example() {
  const [value, setValue] = useState("中等")
  return (
    <div className="p-6">
      <ThinkingPicker value={value} onChange={setValue} />
      <p role="status">强度：{value}</p>
    </div>
  )
}
export default {
  id: "thinking-picker",
  name: "思考强度选择",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/thinking-picker.tsx",
  description:
    "按调用方提供的模型能力显示思考强度，以尾部Check表示选中；未传能力的演示保留默认选项。",
  boundary: "仅控制提交参数；不执行推理。",
  inputs: ["value: 思考强度；options: 当前模型支持的中文等级。"],
  events: ["onChange(value)，方向键只移动焦点，Enter/空格确认。"],
  composition: ["PickerOption"],
  consumers: ["ModelPicker"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "standard",
      name: "强度切换",
      condition: "默认中等。",
      expected: "可切换低、中等、高、极高四个选项。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
