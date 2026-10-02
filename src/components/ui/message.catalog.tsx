import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Bubble, BubbleContent } from "./bubble"
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "./message"
export default {
  id: "message",
  name: "消息骨架",
  layer: "基础组件",
  group: "对话基础",
  source: "src/components/ui/message.tsx",
  description: "消息行、内容、标题和页脚的结构组合。",
  boundary: "不预设业务角色或执行状态。",
  inputs: [
    "align：start / end。",
    "MessageHeader / MessageContent / MessageFooter 内容。",
  ],
  events: ["操作交给页脚中传入的控件。"],
  composition: [
    "MessageGroup、Message、MessageContent、MessageHeader、MessageFooter、Bubble",
  ],
  consumers: ["UserMessage、AssistantMessage"],
  viewport: { width: 600, height: 280 },
  states: [
    {
      id: "pair",
      name: "双向消息",
      condition: "一条尾端消息和一条首端消息。",
      expected: "角色内容与页脚沿同一方向对齐。",
      render: () => (
        <MessageGroup>
          <Message align="end">
            <MessageContent>
              <MessageHeader>用户</MessageHeader>
              <Bubble variant="tinted">
                <BubbleContent>请检查当前目录。</BubbleContent>
              </Bubble>
              <MessageFooter>17:00</MessageFooter>
            </MessageContent>
          </Message>
          <Message>
            <MessageContent>
              <MessageHeader>Moon</MessageHeader>
              <Bubble variant="ghost">
                <BubbleContent>已确认项目入口和目录职责。</BubbleContent>
              </Bubble>
              <MessageFooter>17:01</MessageFooter>
            </MessageContent>
          </Message>
        </MessageGroup>
      ),
    },
  ],
} satisfies CatalogEntry
