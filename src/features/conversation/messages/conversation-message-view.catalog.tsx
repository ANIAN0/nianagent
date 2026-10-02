import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ConversationMessageView } from "./conversation-message-view"
export default {
  id: "conversation-message-view",
  name: "对话消息行",
  layer: "复合组件",
  group: "对话消息",
  source: "src/features/conversation/messages/conversation-message-view.tsx",
  description: "根据角色选择正式用户消息或Agent回复，供滚动列表复用。",
  boundary: "不持有会话状态，不执行发送或工具。",
  inputs: ["message: ConversationMessage"],
  events: ["onRetry", "onOpenAttachment"],
  composition: ["UserMessage", "AssistantMessage"],
  consumers: ["ConversationThread"],
  viewport: { width: 780, height: 400 },
  states: [
    {
      id: "turn",
      name: "一轮对话",
      condition: "用户与Agent消息",
      expected: "用户右对齐、Agent沿阅读轴左对齐。",
      render: () => (
        <div className="flex flex-col gap-6 p-6">
          <ConversationMessageView
            message={{
              id: "user",
              role: "user",
              status: "settled",
              text: "请检查当前项目结构。",
            }}
          />
          <ConversationMessageView
            message={{
              id: "assistant",
              role: "assistant",
              status: "settled",
              text: "当前项目按功能分组，首页和对话页面各自维护组件。",
            }}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
