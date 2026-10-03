import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ConversationListFeedback } from "./conversation-list-feedback"
function Failure() {
  const [failed, setFailed] = useState(true)
  return (
    <div className="p-3">
      <ConversationListFeedback
        state={failed ? "error" : "ready"}
        error="本地会话目录无法读取。"
        onRetry={() => setFailed(false)}
      />
      {!failed && <p role="status">重新读取成功</p>}
    </div>
  )
}
export default {
  id: "conversation-list-feedback",
  name: "会话列表反馈",
  layer: "复合组件",
  group: "侧栏导航",
  source: "src/features/home/conversation-list-feedback.tsx",
  description: "会话目录的加载、首次读取错误及刷新失败反馈。",
  boundary: "只表达列表读取状态；重试与数据保留由调用方控制。",
  inputs: ["state: loading/ready/error；error；hasItems。"],
  events: ["onRetry。"],
  composition: ["Alert", "Button", "Skeleton", "Spinner"],
  consumers: ["ConversationHistory", "ConversationSearch"],
  viewport: { width: 280, height: 220 },
  states: [
    {
      id: "loading",
      name: "首次加载",
      condition: "尚无历史。",
      expected: "骨架与屏幕阅读器加载提示。",
      render: () => <ConversationListFeedback state="loading" />,
    },
    {
      id: "error",
      name: "错误重试",
      condition: "读取失败。",
      expected: "解释原因并提供明确重试动作。",
      render: () => <Failure />,
    },
    {
      id: "refresh-error",
      name: "更新失败",
      condition: "已有历史。",
      expected: "说明未能更新，由父级保留已有记录。",
      render: () => (
        <ConversationListFeedback
          state="error"
          hasItems
          error="本地服务暂时不可用。"
        />
      ),
    },
  ],
} satisfies CatalogEntry
