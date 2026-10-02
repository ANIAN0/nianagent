import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { UserMenu } from "./user-menu"

function Example() {
  const [event, setEvent] = useState("尚未打开设置")
  return (
    <div className="p-4">
      <UserMenu onSettings={() => setEvent("设置事件")} />
      <p role="status">{event}</p>
    </div>
  )
}
export default {
  id: "user-menu",
  name: "用户与外观菜单",
  layer: "复合组件",
  group: "侧栏导航",
  source: "src/features/home/user-menu.tsx",
  description: "提供设置入口和深浅/系统主题切换。",
  boundary: "依赖 ThemeProvider；正式页面沿用持久化，预览 Provider 不持久化。",
  inputs: [],
  events: ["onSettings()；外观通过 useTheme.setTheme 更新。"],
  composition: ["DropdownMenu", "Button", "ThemeProvider"],
  consumers: ["HomeSidebar"],
  viewport: { width: 300, height: 360 },
  states: [
    {
      id: "menu",
      name: "设置与主题",
      condition: "由预览提供内存主题 Provider。",
      expected: "设置输出事件，外观选项更改当前预览主题。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
