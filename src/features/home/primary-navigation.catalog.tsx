import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { PrimaryNavigation } from "./primary-navigation"

function Example() {
  const [event, setEvent] = useState("尚未导航")
  return (
    <div className="p-4">
      <PrimaryNavigation
        onNew={() => setEvent("新建会话事件")}
        onPlugins={() => setEvent("插件事件")}
        onScheduled={() => setEvent("定时任务事件")}
      />
      <p role="status">{event}</p>
    </div>
  )
}
export default {
  id: "primary-navigation",
  name: "主导航",
  layer: "复合组件",
  group: "侧栏导航",
  source: "src/features/home/primary-navigation.tsx",
  description: "展示新建会话、插件和定时任务入口。",
  boundary: "只发事件；页面决定重置或显示范围提示，不实现业务路由。",
  inputs: [],
  events: ["onNew()、onPlugins()、onScheduled()。"],
  composition: ["Button"],
  consumers: ["HomeSidebar"],
  viewport: { width: 300, height: 300 },
  states: [
    {
      id: "actions",
      name: "导航事件",
      condition: "三个入口可用。",
      expected: "逐项点击输出对应事件。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
