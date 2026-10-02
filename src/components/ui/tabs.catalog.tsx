import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs"
function Example({ line = false }: { line?: boolean }) {
  return (
    <Tabs defaultValue="tools" className="p-6">
      <TabsList variant={line ? "line" : "default"}>
        <TabsTrigger value="tools">工具</TabsTrigger>
        <TabsTrigger value="instructions">项目指令</TabsTrigger>
        <TabsTrigger value="disabled" disabled>
          不可用
        </TabsTrigger>
      </TabsList>
      <TabsContent value="tools">工具面板</TabsContent>
      <TabsContent value="instructions">项目指令面板</TabsContent>
    </Tabs>
  )
}
export default {
  id: "tabs",
  name: "Tabs",
  layer: "基础组件",
  group: "导航",
  source: "src/components/ui/tabs.tsx",
  description: "同一区域中切换互斥内容。",
  boundary: "使用 Radix 键盘和焦点行为；不持有业务配置。",
  inputs: ["value/defaultValue、variant: default/line、disabled。"],
  events: ["onValueChange(value)。"],
  composition: ["Radix Tabs"],
  consumers: ["SessionConfig"],
  viewport: { width: 480, height: 300 },
  states: [
    {
      id: "default",
      name: "填充标签",
      condition: "两个可用项和一个禁用项。",
      expected: "点击和方向键切换对应面板，跳过禁用项。",
      render: () => <Example />,
    },
    {
      id: "line",
      name: "下划线标签",
      condition: "variant=line。",
      expected: "当前标签显示蓝色下划线，键盘焦点可见。",
      render: () => <Example line />,
    },
  ],
} satisfies CatalogEntry
