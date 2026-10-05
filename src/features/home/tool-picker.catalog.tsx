import { useState } from "react"
import { ToolPicker } from "./tool-picker"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({
  empty = false,
  unavailableSelected = false,
}: {
  empty?: boolean
  unavailableSelected?: boolean
}) {
  const [value, setValue] = useState<string[]>(
    unavailableSelected ? ["read", "missing-shell"] : ["read"]
  )
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
  description:
    "单层工具列表，来源筛选、搜索、当前结果批量选择与同层详情。筛选控件统一32px；列表与筛选共用左右轴，滚动条单独占用轴外间隙。",
  boundary:
    "工具与勾选受控；查询、来源和详情归组件，返回保留滚动与选择；批量仅当前筛选结果，已选不可用项可取消。",
  inputs: ["tools: HomeTool[]、value: string[]。"],
  events: ["onChange(ids)。"],
  composition: ["InputGroup", "Select", "Badge", "Checkbox", "Button"],
  consumers: ["SessionConfig"],
  viewport: { width: 560, height: 500 },
  states: [
    {
      id: "unavailable-selected",
      name: "已选工具不可用",
      condition: "保存配置包含一个已失效工具。",
      expected: "保留已选失效工具及原因，可取消；不能新选失效项。",
      render: () => <Example unavailableSelected />,
    },
    {
      id: "groups",
      name: "多来源工具",
      condition: "内置、插件、MCP，部分选中。",
      expected:
        "来源徽标、当前结果全选/全不选，详情返回保持搜索与滚动；搜索不丢失已有选择。",
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
