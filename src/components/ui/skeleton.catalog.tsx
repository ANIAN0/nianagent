import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Skeleton } from "./skeleton"
export default {
  id: "skeleton",
  name: "加载占位",
  layer: "基础组件",
  group: "反馈",
  source: "src/components/ui/skeleton.tsx",
  description: "加载期间的尺寸占位。",
  boundary: "宿主负责加载文案和状态切换，不模拟真实消息。",
  inputs: ["className 控制占位几何尺寸。"],
  events: ["无交互。"],
  composition: ["Skeleton"],
  consumers: ["加载状态展示"],
  viewport: { width: 520, height: 200 },
  states: [
    {
      id: "lines",
      name: "多行加载",
      condition: "正文尚未读取。",
      expected: "保持三行内容的布局占位。",
      render: () => (
        <div
          role="status"
          aria-label="正在加载"
          className="flex flex-col gap-3 p-4"
        >
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
