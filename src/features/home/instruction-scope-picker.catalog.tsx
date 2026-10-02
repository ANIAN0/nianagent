import { useState } from "react"
import { InstructionScopePicker } from "./instruction-scope-picker"
import type { InstructionScope } from "./home-types"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({ long = false }: { long?: boolean }) {
  const [value, setValue] = useState<InstructionScope>("all")
  return (
    <div className="p-6">
      <InstructionScopePicker
        workspacePath={
          long
            ? "H:/workspace/projects/a-very-long-workspace-name/documentation/frontend/components"
            : "H:/workspace/moon"
        }
        value={value}
        onChange={setValue}
      />
      <p role="status" className="mt-4 text-xs">
        {value}
      </p>
    </div>
  )
}
export default {
  id: "instruction-scope-picker",
  name: "项目指令范围",
  layer: "复合组件",
  group: "会话配置",
  source: "src/features/home/instruction-scope-picker.tsx",
  description: "工作目录信息与连续三行加载范围单选。",
  boundary: "路径和值受控；选择只生成模拟参数，不读取文件。",
  inputs: ["workspacePath、value: all/directory/none。"],
  events: ["onChange(scope)。"],
  composition: ["RadioGroup"],
  consumers: ["SessionConfig"],
  viewport: { width: 560, height: 400 },
  states: [
    {
      id: "scopes",
      name: "三种加载范围",
      condition: "默认全局与目录。",
      expected: "点击整行或键盘方向键切换，始终只有一项选中。",
      render: () => <Example />,
    },
    {
      id: "long-path",
      name: "长路径",
      condition: "路径超过单行。",
      expected: "换行显示，不遮挡选择项。",
      render: () => <Example long />,
    },
  ],
} satisfies CatalogEntry
