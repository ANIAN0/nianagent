import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { HomeSidebar } from "./home-sidebar"
import { homeData } from "../../../ui-catalog/fixtures/home"
function Example({
  empty = false,
  initialCollapsed = false,
}: {
  empty?: boolean
  initialCollapsed?: boolean
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [event, setEvent] = useState("尚未触发事件")
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
    "布局由父级持有；历史折叠由 ConversationHistory 管理，主题由 UserMenu 接入。",
  inputs: ["data: workspaces/conversations；collapsed?: boolean。"],
  events: ["onClose、onNew、onSearch、onNotice。"],
  composition: [
    "PrimaryNavigation",
    "ConversationHistory",
    "UserMenu",
    "Button",
  ],
  consumers: ["HomePage"],
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
      id: "empty",
      name: "暂无会话",
      condition: "历史为空。",
      expected: "显示空历史，其余入口仍可用。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
