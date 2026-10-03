import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { QueueDeliveryControl } from "./queue-delivery-control"
function Preview({ disabled = false }: { disabled?: boolean }) {
  const [mode, setMode] = useState<"single" | "all">("single")
  return (
    <div className="p-4">
      <QueueDeliveryControl
        mode={mode}
        disabled={disabled}
        onChange={setMode}
      />
    </div>
  )
}
export default {
  id: "queue-delivery-control",
  name: "消息交付设置",
  layer: "基础组件",
  group: "对话",
  source: "src/features/conversation/composer/queue-delivery-control.tsx",
  description: "同一会话排队消息的下一批交付数量。",
  boundary: "值由正式后端快照决定；保存失败保持旧值。",
  inputs: ["mode、disabled"],
  events: ["onChange(mode)，保存成功才更新值。"],
  composition: ["DropdownMenu、Button"],
  consumers: ["ConversationComposer、QueueDock"],
  viewport: { width: 400, height: 250 },
  states: [
    {
      id: "ready",
      name: "可选择",
      condition: "队列为空或有待处理项。",
      expected: "均可设置本会话模式，不改草稿。",
      render: () => <Preview />,
    },
    {
      id: "saving",
      name: "保存中",
      condition: "模式提交尚未完成。",
      expected: "禁用再次修改，保留旧有效模式。",
      render: () => <Preview disabled />,
    },
  ],
} satisfies CatalogEntry
