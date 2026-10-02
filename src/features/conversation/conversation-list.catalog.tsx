import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ConversationList } from "./conversation-list"
import { ConversationMessageView } from "./messages/conversation-message-view"

function Example() {
  return (
    <div style={{ height: "100dvh", minHeight: 0 }}>
      <ConversationList
        items={Array.from({ length: 12 }, (_, index) => ({
          id: `message-${index}`,
          turn: index % 2 === 0 ? index / 2 + 1 : undefined,
          prompt: `第 ${index / 2 + 1} 次提问：核对原型的交互`,
          response: "布局和阅读行为已核对。",
          content: (
            <ConversationMessageView
              message={{
                id: `message-${index}`,
                role: index % 2 === 0 ? "user" : "assistant",
                status: "settled",
                text:
                  index % 2 === 0
                    ? "请继续核对原型的交互。"
                    : "## 本次结果\n\n已确认组件的内容与交互。\n\n" +
                      "保持正文阅读宽度，逐项查看展开状态。\n\n".repeat(4),
              }}
            />
          ),
        }))}
      />
    </div>
  )
}
export default {
  id: "conversation-list",
  name: "对话消息列表",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/conversation-list.tsx",
  description: "组合官方 MessageScroller、稳定消息锚点和原型轮次轨。",
  boundary:
    "不生成消息；只管理阅读、轮次定位和返回最新消息。滚动跟随由官方组件负责。",
  inputs: [
    "items：稳定 id、内容 slot、可选 turn / prompt / response。",
    "initialPosition：anchorId / offset / following，仅会话首次挂载时恢复。",
  ],
  events: ["onPositionChange：记录可见锚点和跟随状态。"],
  composition: [
    "MessageScrollerProvider、MessageScroller、MessageScrollerViewport、MessageScrollerContent、MessageScrollerItem、MessageScrollerButton、ConversationNavigator",
  ],
  consumers: ["ConversationPage"],
  viewport: { width: 880, height: 560 },
  states: [
    {
      id: "long",
      name: "多轮阅读",
      condition: "6轮已有消息。",
      expected: "首次在末尾；上滚暂停跟随，轮次轨定位，按钮返回最新。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
