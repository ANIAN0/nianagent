import { ArrowUp } from "lucide-react"
import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Button } from "./button"
function Buttons() {
  const [count, setCount] = useState(0)
  return (
    <div className="flex flex-wrap items-center gap-3 p-6">
      {(
        [
          "default",
          "secondary",
          "outline",
          "ghost",
          "section",
          "destructive",
          "link",
        ] as const
      ).map((variant) => (
        <Button
          key={variant}
          variant={variant}
          onClick={() => setCount((value) => value + 1)}
        >
          {variant}
        </Button>
      ))}
      <Button
        variant="send"
        size="icon"
        aria-label="发送示例"
        onClick={() => setCount((value) => value + 1)}
      >
        <ArrowUp />
      </Button>
      <p role="status">点击次数：{count}</p>
    </div>
  )
}
export default {
  id: "button",
  name: "Button",
  layer: "基础组件",
  group: "操作",
  source: "src/components/ui/button.tsx",
  description:
    "shadcn 操作按钮，统一变体、尺寸与键盘焦点；section 用于低强调目录标题，展开不等于选中；send 专用于原型蓝色的图标发送动作，文字主按钮使用更深的 primary-strong。",
  boundary: "复用官方实现；图标按钮必须提供可访问名称。",
  inputs: ["variant、size、disabled、asChild 及原生 button 属性。"],
  events: ["onClick：鼠标或键盘激活。"],
  composition: ["Radix Slot、CVA"],
  consumers: [
    "WorkspacePicker、MaterialChip、PrimaryNavigation、ConversationGroup、ConversationItem、UserMenu",
    "HomeSidebar、HomePage、InputGroupButton、Dialog、组件库外壳",
  ],
  viewport: { width: 640, height: 240 },
  states: [
    {
      id: "variants",
      name: "变体与点击",
      condition: "有效的按钮变体。",
      expected: "不同变体可键盘聚焦并计数；重置后次数归零。",
      render: () => <Buttons />,
    },
    {
      id: "disabled",
      name: "禁用",
      condition: "disabled=true。",
      expected: "不可激活；Tab 跳过禁用按钮。",
      render: () => (
        <div className="p-6">
          <Button disabled>暂不可发送</Button>
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
