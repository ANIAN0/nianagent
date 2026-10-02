import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Separator } from "./separator"

export default {
  id: "separator",
  name: "Separator",
  layer: "基础组件",
  group: "布局",
  source: "src/components/ui/separator.tsx",
  description: "分隔相邻内容区域。",
  boundary: "使用 orientation 表达方向；默认装饰性，不承担交互。",
  inputs: ["orientation、decorative。"],
  events: ["无。"],
  composition: ["Radix Separator"],
  consumers: ["HomeSidebar", "FieldSeparator"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "horizontal",
      name: "水平分隔",
      condition: "上下两段内容。",
      expected: "水平细线。",
      render: () => (
        <div className="flex flex-col gap-4 p-6">
          <span>上方内容</span>
          <Separator />
          <span>下方内容</span>
        </div>
      ),
    },
    {
      id: "vertical",
      name: "垂直分隔",
      condition: "并列内容。",
      expected: "垂直细线。",
      render: () => (
        <div className="flex h-24 items-center gap-4 p-6">
          <span>左侧</span>
          <Separator orientation="vertical" />
          <span>右侧</span>
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
