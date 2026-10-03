import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { HomeSidebar } from "./home-sidebar"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { HistoryState } from "@/features/conversation/conversation-catalog-service"
function Example({
  empty = false,
  initialCollapsed = false,
  state = "ready",
}: {
  empty?: boolean
  initialCollapsed?: boolean
  state?: HistoryState
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [event, setEvent] = useState("尚未触发事件")
  const [historyState, setHistoryState] = useState(state)
  return (
    <div className="flex h-dvh flex-col">
      <div className="min-h-0 flex-1" style={{ width: collapsed ? 56 : 280 }}>
        <HomeSidebar
          data={{
            ...homeData,
            conversations: empty ? [] : homeData.conversations,
          }}
          collapsed={collapsed}
          onClose={() => setCollapsed((value) => !value)}
          onNew={(id) => setEvent(id ? `在 ${id} 新建会话` : "新建会话")}
          onSearch={() => setEvent("打开搜索")}
          onNotice={setEvent}
          historyState={historyState}
          historyError="本地会话目录暂时无法读取。"
          onHistoryRetry={() => setHistoryState("ready")}
        />
      </div>
      <p role="status" className="p-3 text-xs">
        {event}
      </p>
    </div>
  )
}
export default {
  id: "home-sidebar",
  name: "首页侧栏",
  layer: "复合组件",
  group: "首页",
  source: "src/features/home/home-sidebar.tsx",
  description: "品牌、主导航、工作区会话和本机账户；收起保留图标列。",
  boundary:
    "AppShell持有共享布局和导航边界，App提供真实历史及页面导航；历史折叠由ConversationHistory管理，主题由UserMenu接入。此目录使用独立演示回调。",
  inputs: [
    "data: workspaces/conversations；collapsed?: boolean；historyState、historyError。",
  ],
  events: [
    "onClose、onNew、onSearch、onSelectConversation、onSettings、onNotice、onHistoryRetry。",
  ],
  composition: [
    "PrimaryNavigation",
    "ConversationHistory",
    "UserMenu",
    "Button",
  ],
  consumers: ["AppShell"],
  viewport: { width: 300, height: 700 },
  states: [
    {
      id: "grouped",
      name: "展开侧栏",
      condition: "两组历史记录。",
      expected: "分组折叠、工作区搜索和底部外观菜单可用。",
      render: () => <Example />,
    },
    {
      id: "collapsed",
      name: "图标列",
      condition: "collapsed=true。",
      expected: "保留新建、插件、定时任务、工作区和搜索入口；可展开。",
      render: () => <Example initialCollapsed />,
    },
    {
      id: "loading",
      name: "历史读取中",
      condition: "首次读取未完成。",
      expected: "列表骨架保持行节奏，导航和账户仍可操作。",
      render: () => <Example empty state="loading" />,
    },
    {
      id: "error",
      name: "刷新失败",
      condition: "后续读取失败。",
      expected: "旧列表继续显示，重新读取清除错误。",
      render: () => <Example state="error" />,
    },
    {
      id: "empty",
      name: "暂无会话",
      condition: "历史为空。",
      expected: "显示空历史，其余入口仍可用。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
