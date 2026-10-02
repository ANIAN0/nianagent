import { CirclePause } from "lucide-react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Marker, MarkerContent, MarkerIcon } from "./marker"
export default {
  id: "marker",
  name: "消息标记",
  layer: "基础组件",
  group: "对话基础",
  source: "src/components/ui/marker.tsx",
  description: "系统状态、日期或消息分界标记。",
  boundary: "不代替有交互的消息行。",
  inputs: [
    "variant：default / separator / border。",
    "MarkerIcon 与 MarkerContent。",
  ],
  events: ["无内置交互。"],
  composition: ["Marker、MarkerIcon、MarkerContent"],
  consumers: ["AssistantMessage"],
  viewport: { width: 520, height: 140 },
  states: (["default", "separator", "border"] as const).map((variant) => ({
    id: variant,
    name:
      variant === "default"
        ? "系统状态"
        : variant === "separator"
          ? "居中分界"
          : "底部分界",
    condition: `variant=${variant}。`,
    expected: "图标和文本低对比展示，分界线由变体决定。",
    render: () => (
      <Marker variant={variant}>
        <MarkerIcon>
          <CirclePause />
        </MarkerIcon>
        <MarkerContent>本轮已停止</MarkerContent>
      </Marker>
    ),
  })),
} satisfies CatalogEntry
