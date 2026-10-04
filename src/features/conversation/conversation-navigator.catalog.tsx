import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ConversationNavigator } from "./conversation-navigator"
import { Button } from "@/components/ui/button"

function Example({ count = 8 }: { count?: number }) {
  const [active, setActive] = useState("turn-1")
  return (
    <div
      className="conversation-body"
      style={{ height: 360, position: "relative", margin: 32 }}
    >
      <p>当前轮次：{active.replace("turn-", "")}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setActive(`turn-${count}`)}
      >
        读取最后一轮
      </Button>
      <ConversationNavigator
        activeId={active}
        onNavigate={setActive}
        items={Array.from({ length: count }, (_, index) => ({
          id: `turn-${index + 1}`,
          turn: index + 1,
          prompt: `第 ${index + 1} 次提问：核对原型的阅读体验`,
          response: "已核对消息宽度、输入区及轮次导航。",
        }))}
      />
    </div>
  )
}

export default {
  id: "conversation-navigator",
  name: "会话轮次轨",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/conversation-navigator.tsx",
  description: "沿用原型固定10px节距、当前20px刻度与悬停问答预览。",
  boundary: "只呈现轮次与发送定位事件，滚动由 ConversationList 负责。",
  inputs: ["items：轮次、消息锚点及问答摘要。", "activeId：当前阅读轮次。"],
  events: ["onNavigate(id)；上下键/Home/End 移动焦点，Enter 定位。"],
  composition: ["Button"],
  consumers: ["ConversationList"],
  viewport: { width: 1280, height: 440 },
  states: [
    {
      id: "default",
      name: "多轮导航",
      condition: "8轮消息。",
      expected: "悬停或聚焦展示摘要，选择改变当前刻度。",
      render: () => <Example />,
    },
    {
      id: "long",
      name: "长会话",
      condition: "200轮消息。",
      expected:
        "刻度保持间距；当前项自动保持可见，导航轨内部滚动不抢正文阅读。",
      render: () => <Example count={200} />,
    },
    {
      id: "single",
      name: "仅一轮",
      condition: "1轮消息。",
      expected: "轮次轨隐藏。",
      render: () => <Example count={1} />,
    },
  ],
} satisfies CatalogEntry
