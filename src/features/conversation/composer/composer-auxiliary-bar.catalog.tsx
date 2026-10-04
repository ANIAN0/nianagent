import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ComposerPanelProvider } from "@/features/home/composer-panel-context"
import { ComposerAuxiliaryBar } from "./composer-auxiliary-bar"

function Example({
  queuedCount = 0,
  unknown = false,
  noContext = false,
  blocked = false,
}: {
  queuedCount?: number
  unknown?: boolean
  noContext?: boolean
  blocked?: boolean
}) {
  const [mode, setMode] = useState<"single" | "all">("single")
  const [unconfirmed, setUnconfirmed] = useState(unknown)
  return (
    <div className="flex min-h-80 flex-col justify-end p-4">
      <ComposerPanelProvider>
        <ComposerAuxiliaryBar
          deliveryMode={mode}
          queuedCount={queuedCount}
          onDeliveryModeChange={setMode}
          modeDisabledReason={
            blocked ? "正在保存当前配置，保存完成后可修改交付方式。" : undefined
          }
          modeIssue={
            unconfirmed
              ? {
                  code: "result_unknown",
                  message: "尚未确认交付设置是否保存。当前生效值保留。",
                  severity: "warning",
                  recovery: "check",
                }
              : undefined
          }
          onCheckMode={() => setUnconfirmed(false)}
          context={
            noContext
              ? undefined
              : {
                  usedTokens: 42000,
                  contextWindow: 100000,
                  source: "pi-context-estimate",
                  estimated: true,
                  onCompact: () => {},
                }
          }
        />
      </ComposerPanelProvider>
    </div>
  )
}
export default {
  id: "composer-auxiliary-bar",
  name: "对话输入辅助栏",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/composer-auxiliary-bar.tsx",
  description: "完整输入组件卡下方的固定交付方式与上下文入口。",
  boundary:
    "父级提供Pi真实模式与统计；无上下文数据不会隐藏交付方式。有队列时不移动入口，反馈只归属于交付操作。",
  inputs: [
    "context可选；deliveryMode/onDeliveryModeChange；queuedCount只说明待处理数量。",
    "modeIssue、onCheckMode、modeDisabledReason：原提交核对与具体写锁原因；只读核对不被写锁禁用。",
  ],
  events: [
    "交付修改交给父级保存后更新；上下文打开详情与压缩；未知操作只能核对。",
  ],
  composition: [
    "QueueDeliveryControl",
    "ContextUsage",
    "OperationFeedback",
    "RecoveryAction",
  ],
  consumers: ["ConversationComposer"],
  viewport: { width: 560, height: 400 },
  states: [
    {
      id: "empty-queue",
      name: "无等待消息",
      condition: "统计可用，空队列。",
      expected: "两项辅助入口同一基线，菜单说明设置用于后续排队。",
      render: () => <Example />,
    },
    {
      id: "queued",
      name: "十条等待消息",
      condition: "队列非空。",
      expected: "交付入口保持原位，菜单展示真实等待数量。",
      render: () => <Example queuedCount={10} />,
    },
    {
      id: "no-context",
      name: "无上下文数据",
      condition: "统计尚未提供。",
      expected: "交付设置仍可发现、可操作，不依赖上下文。",
      render: () => <Example noContext />,
    },
    {
      id: "unknown",
      name: "交付保存结果未知",
      condition: "已发出保存，未确认结果。",
      expected: "保持原模式；键盘可读禁用原因；只显示一次反馈与核对。",
      render: () => <Example unknown />,
    },
    {
      id: "blocked",
      name: "当前配置保存中",
      condition: "父级有明确操作锁。",
      expected: "交付不可更改，键盘/悬停可读实际原因，上下文仍可阅读。",
      render: () => <Example blocked />,
    },
  ],
} satisfies CatalogEntry
