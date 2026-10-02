import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { UserMessage } from "./user-message"
export default {
  id: "conversation-user-message",
  name: "用户消息",
  layer: "复合组件",
  group: "对话消息",
  source: "src/features/conversation/messages/user-message.tsx",
  description: "右侧浅色气泡，保持原始文本，附件置于正文上方。",
  boundary: "用户输入不会解释成 Markdown。",
  inputs: ["message: ConversationMessage"],
  events: ["onOpenAttachment"],
  composition: ["Message", "Bubble", "MessageAttachments", "MessageActions"],
  consumers: ["ConversationMessageView"],
  viewport: { width: 780, height: 340 },
  states: [
    {
      id: "default",
      name: "普通文本",
      condition: "含Markdown字符",
      expected: "双星号、换行原样显示，不解释成富文本。",
      render: () => (
        <div className="p-6">
          <UserMessage
            message={{
              id: "user",
              role: "user",
              status: "settled",
              text: "请保留 **原型设计**。\n先检查消息展示，再调整输入区。",
              time: "2026-10-02T09:30:00+08:00",
            }}
          />
        </div>
      ),
    },
    {
      id: "attachment",
      name: "带附件",
      condition: "文件已发送",
      expected: "附件在气泡之前，可预览。",
      render: () => (
        <div className="p-6">
          <UserMessage
            message={{
              id: "user",
              role: "user",
              status: "sending",
              text: "请阅读这份说明。",
              attachments: [
                {
                  id: "doc",
                  name: "说明.md",
                  kind: "file",
                  content: "沿用已经确认的设计。",
                },
              ],
            }}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
