import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ContextUsage } from "./context-usage"
function Example({
  unknown = false,
  blocked = false,
}: {
  unknown?: boolean
  blocked?: boolean
}) {
  const [used, setUsed] = useState(53760)
  return (
    <div className="flex h-96 items-end justify-center p-4">
      <ContextUsage
        usedTokens={unknown ? undefined : used}
        contextWindow={128000}
        breakdown={
          unknown
            ? undefined
            : {
                systemTokens: 4000,
                toolsTokens: 9000,
                messageTokens: used - 13000,
              }
        }
        cumulative={{
          inputTokens: 81600,
          outputTokens: 6300,
          cacheReadTokens: 42000,
        }}
        updatedAt="14:32"
        onCompact={() => setUsed(26000)}
        compactDisabledReason={
          blocked ? "当前正在执行，结束后可压缩。" : undefined
        }
      />
    </div>
  )
}
export default {
  id: "context-usage",
  name: "上下文用量",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/context-usage.tsx",
  description:
    "输入卡下方的用量入口，展开上下文分解、范围、累计统计和压缩动作。",
  boundary: "数值由父级提供，未知不显示零；压缩仅发事件，不改变真实会话。",
  inputs: [
    "usedTokens/contextWindow、breakdown、cumulative、updatedAt、onCompact、compactDisabledReason",
  ],
  events: ["点击展开用量；压缩触发父级模拟更新。"],
  composition: ["Button、Popover、Badge、Separator、Lucide CircleGauge"],
  consumers: ["ConversationComposer"],
  viewport: { width: 600, height: 480 },
  states: [
    {
      id: "ready",
      name: "42%用量",
      condition: "可信模拟占用",
      expected: "显示42%，展开明细，压缩后更新用量。",
      render: () => <Example />,
    },
    {
      id: "unknown",
      name: "占用未知",
      condition: "无占用数据",
      expected: "显示上下文未知，不冒充0%。",
      render: () => <Example unknown />,
    },
    {
      id: "running",
      name: "执行中不可压缩",
      condition: "禁止压缩原因",
      expected: "禁用并解释原因。",
      render: () => <Example blocked />,
    },
  ],
} satisfies CatalogEntry
