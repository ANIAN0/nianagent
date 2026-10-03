import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { MessageActions } from "./message-actions"
function RetryExample() {
  const [count, setCount] = useState(0)
  return (
    <div className="p-6">
      <MessageActions
        text="已完成检查。"
        time="2026-10-02T09:30:00+08:00"
        model="DeepSeek V3.2"
        onRetry={() => setCount(count + 1)}
      />
      <p role="status">重试次数：{count}</p>
    </div>
  )
}
export default {
  id: "conversation-message-actions",
  name: "消息操作栏",
  layer: "复合组件",
  group: "对话消息",
  source: "src/features/conversation/messages/message-actions.tsx",
  description: "28px图标操作、复制反馈、消息信息、可选重新生成与独立会话分支。",
  boundary:
    "仅有模型记录时显示消息信息；重试只发出事件，运行及消息替换由会话状态负责。",
  inputs: [
    "text",
    "time",
    "model",
    "align",
    "running",
    "forkPending/forkDisabledReason",
  ],
  events: ["onRetry()", "onFork()"],
  composition: ["CopyButton", "Button", "Tooltip", "Popover", "ForkAction"],
  consumers: ["UserMessage", "AssistantMessage"],
  viewport: { width: 650, height: 340 },
  states: [
    {
      id: "assistant",
      name: "Agent操作",
      condition: "允许重新生成",
      expected: "复制、信息及重试可操作，时间在尾部。",
      render: () => <RetryExample />,
    },
    {
      id: "user",
      name: "用户操作",
      condition: "右对齐",
      expected: "时间在前，不显示无内容的信息入口或重试。",
      render: () => (
        <div className="p-6">
          <MessageActions
            text="请检查首页。"
            time="2026-10-02T09:30:00+08:00"
            align="end"
          />
        </div>
      ),
    },
    {
      id: "streaming",
      name: "输出中",
      condition: "正在输出",
      expected: "可复制当前正文，重试不可用。",
      render: () => (
        <div className="p-6">
          <MessageActions text="正在整理" running onRetry={() => {}} />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
