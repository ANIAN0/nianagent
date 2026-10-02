import { useState } from "react"
import { ToolPicker } from "./tool-picker"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({ empty = false }: { empty?: boolean }) {
  const [value, setValue] = useState<string[]>(["read"])
  return (
    <div className="flex h-dvh flex-col gap-3 p-6">
      <ToolPicker
        tools={
          empty
            ? []
            : [
                ...homeData.tools,
                {
                  id: "missing-shell",
                  name: "Bash",
                  description: "运行本地命令",
                  group: "Pi 内置工具",
                  detail: "需安装Bash。",
                  available: false,
                  unavailableReason: "未找到 Bash 可执行文件",
                },
              ]
        }
        value={value}
        onChange={setValue}
      />
      <p role="status" className="text-xs">
        已选：{value.join(", ") || "无"}
      </p>
    </div>
  )
}
export default {
  id: "tool-picker",
  name: "工具选择",
  layer: "复合组件",
  group: "会话配置",
  source: "src/features/home/tool-picker.tsx",
  description: "按来源分组工具，提供搜索、单选勾选、整组操作与详情。",
  boundary:
    "工具数据及勾选受控，持有搜索词和展开的详情；不执行工具。整组操作作用于来源全组，搜索不改变作用范围。",
  inputs: ["tools: HomeTool[]、value: string[]。"],
  events: ["onChange(ids)。"],
  composition: ["InputGroup", "Checkbox", "Button"],
  consumers: ["SessionConfig"],
  viewport: { width: 560, height: 500 },
  states: [
    {
      id: "groups",
      name: "多来源工具",
      condition: "内置、插件、MCP，部分选中。",
      expected: "分组数量、全选/全不选、搜索及详情一致；搜索不丢失已有选择。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "无可用工具",
      condition: "工具数组为空。",
      expected: "显示暂无可用工具。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
