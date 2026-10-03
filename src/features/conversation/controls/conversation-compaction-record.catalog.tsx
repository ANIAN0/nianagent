import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ConversationList } from "../conversation-list"
import { ConversationMessageView } from "../messages/conversation-message-view"
import { ConversationCompactionRecord } from "./conversation-compaction-record"
const messages = [
  {
    id: "message-kept",
    entryId: "entry-kept",
    historyIndex: 2,
    role: "user" as const,
    text: "保留的用户请求：继续完善当前任务。",
    time: "2026-10-03T09:20:00Z",
    status: "settled" as const,
  },
]
function Example() {
  return (
    <div className="h-dvh">
      <ConversationList
        items={[
          {
            id: "record-summary",
            content: (
              <ConversationCompactionRecord
                record={{
                  id: "entry-summary",
                  historyIndex: 8,
                  firstKeptHistoryIndex: 2,
                  firstKeptEntryId: "entry-kept",
                  time: "2026-10-03T09:21:00Z",
                  tokensBefore: 24000,
                  summary: "已完成基础准备，保留任务目标与后续工作。",
                  source: "manual",
                }}
                messages={messages}
              />
            ),
          },
          {
            id: messages[0]!.id,
            content: <ConversationMessageView message={messages[0]!} />,
          },
        ]}
      />
    </div>
  )
}
export default {
  id: "conversation-compaction-record",
  name: "摘要历史定位",
  layer: "复合组件",
  group: "对话",
  source:
    "src/features/conversation/controls/conversation-compaction-record.tsx",
  description: "在正式会话滚动上下文中定位真实保留历史。",
  boundary:
    "使用MessageScroller公共入口，不改写发送上下文；无法定位时说明原因。",
  inputs: ["record/messages"],
  events: ["展开、定位保留起点"],
  composition: ["CompactionRecord、MessageScroller"],
  consumers: ["LiveConversationView"],
  viewport: { width: 900, height: 560 },
  states: [
    {
      id: "ready",
      name: "摘要与保留历史",
      condition: "存在可定位消息",
      expected: "定位动作滚动到正式消息，不发送请求。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
