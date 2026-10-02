import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Button } from "./button"
import { Bubble, BubbleContent } from "./bubble"
import { Message, MessageContent } from "./message"
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "./message-scroller"
function Example({ autoScroll = true }: { autoScroll?: boolean }) {
  const [count, setCount] = useState(14)
  return (
    <div className="flex h-dvh flex-col gap-3 p-4">
      <Button
        variant="outline"
        onClick={() => setCount((current) => current + 1)}
      >
        追加一条消息
      </Button>
      <MessageScrollerProvider
        autoScroll={autoScroll}
        defaultScrollPosition="end"
      >
        <MessageScroller>
          <MessageScrollerViewport aria-label="消息滚动展示">
            <MessageScrollerContent className="p-4">
              {Array.from({ length: count }, (_, index) => (
                <MessageScrollerItem
                  key={index}
                  messageId={`demo-${index}`}
                  scrollAnchor={index % 2 === 0}
                >
                  <Message align={index % 2 === 0 ? "end" : "start"}>
                    <MessageContent>
                      <Bubble variant={index % 2 === 0 ? "tinted" : "ghost"}>
                        <BubbleContent>
                          第 {index + 1}{" "}
                          条消息：查看消息滚动、定位和返回最新内容。
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton aria-label="回到最新消息" />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  )
}
export default {
  id: "message-scroller",
  name: "消息滚动容器",
  layer: "基础组件",
  group: "对话基础",
  source: "src/components/ui/message-scroller.tsx",
  description: "官方消息滚动、锚点和返回最新消息控件。",
  boundary: "业务层不重复实现自动跟随；Provider 必须包含整套滚动组件。",
  inputs: [
    "Provider：autoScroll / defaultScrollPosition / scrollMargin。",
    "Item：messageId / scrollAnchor。",
    "Viewport：preserveScrollOnPrepend。",
  ],
  events: [
    "上滚进入阅读；回到最新按钮恢复末尾。",
    "useMessageScroller 暴露定位消息与首尾的 API。",
  ],
  composition: [
    "MessageScrollerProvider、MessageScroller、MessageScrollerViewport、MessageScrollerContent、MessageScrollerItem、MessageScrollerButton、Button",
  ],
  consumers: ["ConversationList"],
  viewport: { width: 660, height: 520 },
  states: [
    {
      id: "following",
      name: "自动跟随",
      condition: "autoScroll=true。",
      expected:
        "初次位于末尾；追加消息时按跟随状态滚动，上滚后可点击回到最新。",
      render: () => <Example />,
    },
    {
      id: "manual",
      name: "手动阅读",
      condition: "autoScroll=false。",
      expected: "追加内容不自动拉走阅读位置；返回最新按钮可用。",
      render: () => <Example autoScroll={false} />,
    },
  ],
} satisfies CatalogEntry
