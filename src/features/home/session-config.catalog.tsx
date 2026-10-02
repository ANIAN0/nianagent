import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { SessionOptions } from "./home-types"
import { SessionConfig } from "./session-config"
function Example({ empty = false }: { empty?: boolean }) {
  const [value, setValue] = useState<SessionOptions>({
    toolIds: empty ? [] : homeData.tools.map((tool) => tool.id),
    instructionScope: "all",
  })
  return (
    <div className="@container p-6">
      <SessionConfig
        tools={empty ? [] : homeData.tools}
        value={value}
        workspacePath={homeData.workspaces[0]!.path}
        onChange={setValue}
      />
      <p role="status" className="mt-4 text-sm">
        已应用：{value.toolIds.length} 个工具 · {value.instructionScope}
      </p>
    </div>
  )
}
export default {
  id: "session-config",
  name: "会话配置",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/session-config.tsx",
  description: "在工具和项目指令两个面板中修改会话候选配置。",
  boundary: "弹窗拥有候选值；取消丢弃，应用后才回写父级；重开从父级值初始化。",
  inputs: ["tools、value: SessionOptions、workspacePath。"],
  events: ["onChange(value)，仅应用时触发。"],
  composition: [
    "Dialog",
    "Tabs",
    "ToolPicker",
    "InstructionScopePicker",
    "Button",
  ],
  consumers: ["ComposerToolbar"],
  viewport: { width: 720, height: 620 },
  states: [
    {
      id: "enabled",
      name: "完整配置",
      condition: "内置、插件和 MCP 三组模拟工具。",
      expected:
        "搜索、整组选中、详情可操作；取消不改变摘要，应用同步工具数和范围。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "无可用工具",
      condition: "工具数组为空。",
      expected: "空状态清晰，仍可切换项目指令；未修改时应用禁用。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
