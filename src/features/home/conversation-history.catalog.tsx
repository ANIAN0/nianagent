import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ConversationHistory } from "./conversation-history"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { HistoryState } from "@/features/conversation/conversation-catalog-service"
function Example({
  empty = false,
  state = "ready",
}: {
  empty?: boolean
  state?: HistoryState
}) {
  const [event, setEvent] = useState("尚未选择会话")
  const [historyState, setHistoryState] = useState(state)
  return (
    <div className="flex h-dvh flex-col p-3">
      <ConversationHistory
        data={{
          ...homeData,
          conversations: empty ? [] : homeData.conversations,
        }}
        onSelect={(item) => setEvent(item.title)}
        historyState={historyState}
        historyError={
          historyState === "error" ? "本地会话目录暂时无法读取。" : ""
        }
        onHistoryRetry={() => setHistoryState("ready")}
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
  inputs: [
    "data: workspaces/conversations；historyState: loading/ready/error；historyError。",
  ],
  events: ["onSelect(conversation)、onNew?(workspaceId)、onHistoryRetry。"],
  composition: ["ConversationGroup", "ConversationListFeedback", "Empty"],
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
      id: "loading",
      name: "首次读取",
      condition: "列表尚未返回。",
      expected: "显示骨架与可读加载状态，不误报暂无会话。",
      render: () => <Example empty state="loading" />,
    },
    {
      id: "error",
      name: "读取失败",
      condition: "未取得历史且接口失败。",
      expected: "明确错误及重新读取；成功后显示空历史。",
      render: () => <Example empty state="error" />,
    },
    {
      id: "refresh-error",
      name: "刷新失败保留历史",
      condition: "已有历史的后续读取失败。",
      expected: "保留可用列表，错误提示不会替换历史。",
      render: () => <Example state="error" />,
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
