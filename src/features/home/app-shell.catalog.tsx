import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { homeData } from "../../../ui-catalog/fixtures/home"
import { AppShell } from "./app-shell"

function Example() {
  const [id, setId] = useState<string>()
  return (
    <AppShell
      data={homeData}
      activeConversationId={id}
      onNew={() => setId(undefined)}
      onSelectConversation={(item) => setId(item.id)}
    >
      <div className="flex flex-1 items-center justify-center p-12 text-sm text-muted-foreground">
        {homeData.conversations.find((item) => item.id === id)?.title ??
          "新建工作区内容"}
      </div>
    </AppShell>
  )
}
export default {
  id: "app-shell",
  name: "应用布局",
  layer: "页面",
  group: "工作空间",
  source: "src/features/home/app-shell.tsx",
  description: "首页、对话和设置共享的侧栏、搜索与移动导航。",
  boundary:
    "内容由children传入，导航事件由应用处理，不保存会话消息。正式App通过NavigationBoundaryContext与配置保存共用导航边界；保存期间鼠标入口和快捷键均等待，独立展示默认不阻断。",
  inputs: [
    "data、activeConversationId、children；historyState、historyIssue（正式错误与恢复语义）、historyError兼容文字同时传入侧栏和搜索。",
  ],
  events: [
    "onNew、onSelectConversation、onSettings、onHistoryRetry；Ctrl+B切换导航，Ctrl+K搜索；持有保存租约时不打开第二个浮层、不卸载正在保存的页面。联动状态见会话配置/保存期间的应用导航边界。",
  ],
  composition: ["HomeSidebar、ConversationSearch、Dialog、Button"],
  consumers: ["App、HomePage"],
  viewport: { width: 1280, height: 720 },
  states: [
    {
      id: "default",
      name: "导航与选中",
      condition: "模拟历史记录。",
      expected: "点击历史和搜索结果切换选中，导航折叠/宽度调整/移动抽屉可用。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
