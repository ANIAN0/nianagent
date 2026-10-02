import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ConversationHistory } from "./conversation-history"
import { homeData } from "../../../ui-catalog/fixtures/home"
function Example({ empty = false }: { empty?: boolean }) {
  const [event, setEvent] = useState("尚未选择会话")
  return (
    <div className="flex h-dvh flex-col p-3">
      <ConversationHistory
        data={{
          ...homeData,
          conversations: empty ? [] : homeData.conversations,
        }}
        onSelect={(item) => setEvent(item.title)}
      />
      <p role="status" className="text-xs">
        {event}
      </p>
    </div>
  )
}
export default {
  id: "conversation-history",
  name: "工作区会话列表",
  layer: "复合组件",
  group: "侧栏导航",
  source: "src/features/home/conversation-history.tsx",
  description: "按工作目录组织历史会话。",
  boundary: "只持有分组折叠状态；搜索单独由 ConversationSearch 承担。",
  inputs: ["data: workspaces/conversations。"],
  events: ["onSelect(conversation)、onNew?(workspaceId)。"],
  composition: ["ConversationGroup", "Empty"],
  consumers: ["HomeSidebar"],
  viewport: { width: 280, height: 600 },
  states: [
    {
      id: "grouped",
      name: "分组历史",
      condition: "两组会话。",
      expected: "组标题可折叠/展开，选择会话输出标题。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "空历史",
      condition: "无会话。",
      expected: "显示暂无会话。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
