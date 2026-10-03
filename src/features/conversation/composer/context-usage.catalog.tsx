import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ContextUsage, type ContextUsageProps } from "./context-usage"

function Example({
  reading,
  closed = false,
}: {
  reading: ContextUsageProps
  closed?: boolean
}) {
  return (
    <div className="flex h-dvh items-end justify-center p-6">
      <ContextUsage {...reading} defaultOpen={!closed} />
    </div>
  )
}
const reading: ContextUsageProps = {
  usedTokens: 53760,
  contextWindow: 128000,
  source: "pi-context-estimate",
  estimated: true,
  observedAt: "2026-10-03T09:20:00Z",
}
export default {
  id: "context-usage",
  name: "上下文用量",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/context-usage.tsx",
  description:
    "输入卡下方的上下文入口，说明记录来源、估算含义、时间及历史恢复状态。",
  boundary:
    "数值由正式快照提供；没有数据不冒充0。分项和累计仅在传入真实记录时显示；正式入口不提供尚未接入的手动压缩动作。",
  inputs: [
    "usedTokens/contextWindow、source/estimated/observedAt/restored",
    "status/reason、defaultOpen",
    "可选 breakdown/cumulative/updatedAt/onCompact/compactDisabledReason",
  ],
  events: ["点击入口或Esc展开/关闭；可选onCompact仅发送父级事件"],
  composition: ["Button、Popover、Badge、Separator、Lucide CircleGauge"],
  consumers: ["ConversationComposer"],
  viewport: { width: 600, height: 480 },
  states: [
    {
      id: "ready",
      name: "Pi 估算详情",
      condition: "有明确来源和统计时间",
      expected: "显示42%、Pi来源、估算说明与时间，不声称精确计费。",
      render: () => <Example reading={reading} />,
    },
    {
      id: "closed",
      name: "折叠入口",
      condition: "默认未展开",
      expected: "轻量42%入口，点击后展开同一详情。",
      render: () => <Example reading={reading} closed />,
    },
    {
      id: "unknown",
      name: "占用未知",
      condition: "没有可用用量",
      expected: "显示未知与原因，不出现估算徽标或0%。",
      render: () => (
        <Example
          reading={{
            status: "unavailable",
            contextWindow: 128000,
            reason: "尚无可用的模型用量记录。",
          }}
        />
      ),
    },
    {
      id: "awaiting-response",
      name: "压缩后待更新",
      condition: "压缩后Pi尚未收到下一轮用量",
      expected: "显示上下文待更新及原因，不复用压缩前读数。",
      render: () => (
        <Example
          reading={{
            status: "awaiting-response",
            contextWindow: 128000,
            observedAt: "2026-10-03T09:22:00Z",
            reason: "压缩已完成，下一次模型回复后更新上下文用量。",
          }}
        />
      ),
    },
    {
      id: "restored",
      name: "重启后历史统计",
      condition: "restored=true",
      expected: "显示历史恢复和原始更新时间，不冒充实时请求统计。",
      render: () => <Example reading={{ ...reading, restored: true }} />,
    },
    {
      id: "small",
      name: "不足百分之一",
      condition: "已记录用量为4000/1000000",
      expected: "显示<1%，详情保留实际估算值；不将非零占用显示为0%。",
      render: () => (
        <Example
          reading={{ ...reading, usedTokens: 4000, contextWindow: 1000000 }}
        />
      ),
    },
    {
      id: "zero",
      name: "已记录零占用",
      condition: "Pi明确返回usedTokens=0",
      expected: "只有明确记录才显示0%，并保留来源。",
      render: () => <Example reading={{ ...reading, usedTokens: 0 }} />,
    },
    {
      id: "source-unknown",
      name: "来源未记录",
      condition: "旧数据有数值但没有来源",
      expected: "显示未记录和无法确认的说明，不声称Pi估算。",
      render: () => (
        <Example reading={{ usedTokens: 30000, contextWindow: 128000 }} />
      ),
    },
  ],
} satisfies CatalogEntry
