import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { PickerOption, navigatePicker } from "./picker-option"
function Example() {
  const [value, setValue] = useState(0)
  return (
    <div
      role="menu"
      aria-label="选项示例"
      onKeyDown={navigatePicker}
      className="w-72 max-w-full p-3"
    >
      {["短模型", "同名模型-超长服务版本标识-2026-October-Enterprise"].map(
        (name, index) => (
          <PickerOption
            key={name}
            selected={value === index}
            description={`model-${index}`}
            onSelect={() => setValue(index)}
          >
            {name}
          </PickerOption>
        )
      )}
    </div>
  )
}
export default {
  id: "picker-option",
  name: "模型菜单选项",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/picker-option.tsx",
  description: "支持换行的菜单单选项，固定尾部Check；焦点与提交分离。",
  boundary: "只发确认事件，不负责弹层或业务请求。",
  inputs: ["selected/children/description"],
  events: ["onSelect"],
  composition: ["Button"],
  consumers: ["ModelPicker", "ThinkingPicker"],
  viewport: { width: 400, height: 350 },
  states: [
    {
      id: "default",
      name: "长短名与选中态",
      condition: "两个候选",
      expected: "方向键只移动，Enter/空格确认；Check不被挤出",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
