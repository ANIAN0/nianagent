import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ForkAction } from "./fork-action"
function Example({ reason }: { reason?: string }) {
  const [pending, setPending] = useState(false)
  return (
    <div className="flex items-center gap-3 p-6">
      <ForkAction
        disabledReason={reason}
        pending={pending}
        onFork={() => setPending(true)}
      />
      <span className="text-sm text-muted-foreground">
        {pending ? "正在创建会话分支" : "已完成回复的尾部动作"}
      </span>
    </div>
  )
}
export default {
  id: "fork-action",
  name: "会话分支动作",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/controls/fork-action.tsx",
  description: "稳定Agent回复尾部的派生入口。",
  boundary: "只发出父级事件，门禁与权威entryId由Host投影提供；用户消息不显示。",
  inputs: ["pending/disabledReason"],
  events: ["onFork"],
  composition: ["Button、Tooltip、Lucide GitBranch"],
  consumers: ["MessageActions、AssistantMessage"],
  viewport: { width: 560, height: 280 },
  states: [
    {
      id: "ready",
      name: "已完成回复",
      condition: "来源空闲且边界稳定",
      expected: "与复制按钮同尺寸，点击后忙碌且防重复。",
      render: () => <Example />,
    },
    {
      id: "busy",
      name: "来源执行中",
      condition: "来源忙",
      expected: "入口保留并说明原因。",
      render: () => <Example reason="会话正在执行，请等待回复结束。" />,
    },
  ],
} satisfies CatalogEntry
