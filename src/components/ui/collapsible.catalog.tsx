import { ChevronDown } from "lucide-react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Button } from "./button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible"
function Example({
  open = false,
  disabled = false,
}: {
  open?: boolean
  disabled?: boolean
}) {
  return (
    <Collapsible defaultOpen={open} disabled={disabled}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost">
          <ChevronDown data-icon="inline-start" />
          执行详情
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p>已读取工作区内的项目说明。</p>
      </CollapsibleContent>
    </Collapsible>
  )
}
export default {
  id: "collapsible",
  name: "折叠内容",
  layer: "基础组件",
  group: "布局",
  source: "src/components/ui/collapsible.tsx",
  description: "Radix 折叠区域，保留触发器与内容的可访问关联。",
  boundary: "展开内容由业务提供。",
  inputs: ["open / defaultOpen / onOpenChange / disabled。"],
  events: ["点击或键盘操作触发器切换展开状态。"],
  composition: ["Collapsible、CollapsibleTrigger、CollapsibleContent、Button"],
  consumers: ["ThinkingBlock、ExecutionProcess、ToolCall"],
  viewport: { width: 500, height: 180 },
  states: [
    {
      id: "closed",
      name: "默认收起",
      condition: "defaultOpen=false。",
      expected: "点击或 Enter 展开详情。",
      render: () => <Example />,
    },
    {
      id: "open",
      name: "默认展开",
      condition: "defaultOpen=true。",
      expected: "内容可见且能收起。",
      render: () => <Example open />,
    },
    {
      id: "disabled",
      name: "禁用",
      condition: "disabled=true。",
      expected: "触发器不可操作。",
      render: () => <Example disabled />,
    },
  ],
} satisfies CatalogEntry
