import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { homeData } from "../../../../ui-catalog/fixtures/home"
import { QueueDock, type QueueDockProps } from "./queue-dock"
function Example({
  count,
  running = true,
}: {
  count: number
  running?: boolean
}) {
  const [items, setItems] = useState<QueueDockProps["items"]>(() =>
    Array.from({ length: count }, (_, i) => ({
      id: String(i),
      draft: {
        workspaceId: homeData.workspaces[0].id,
        text: ["补充检查深色主题和键盘操作", "随后整理本次变更说明"][i],
        model: homeData.models[0],
        thinking: "中等",
        materials: i === 0 ? [homeData.materials[0]] : [],
        session: { toolIds: [], instructionScope: "all" },
      },
    }))
  )
  const [mode, setMode] = useState<"single" | "all">("single")
  const [notice, setNotice] = useState("")
  return (
    <div className="p-4">
      <QueueDock
        items={items}
        running={running}
        deliveryMode={mode}
        onDeliveryModeChange={setMode}
        onEdit={(id, text) =>
          setItems(
            items.map((item) =>
              item.id === id
                ? { ...item, draft: { ...item.draft, text } }
                : item
            )
          )
        }
        onRemove={(id) => setItems(items.filter((item) => item.id !== id))}
        onSendNow={(id) => {
          setItems(items.filter((item) => item.id !== id))
          setNotice(running ? "已补充当前工作" : "已开始处理这条消息")
        }}
      />
      <p role="status">{notice}</p>
    </div>
  )
}
export default {
  id: "queue-dock",
  name: "排队消息",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/queue-dock.tsx",
  description: "贴合输入卡上沿的排队消息，提供编辑、删除及立即补充当前工作。",
  boundary: "父级持有队列与交付模式；本组件仅保存折叠和编辑中的文字。",
  inputs: [
    "items:{id,draft}[]、running、busy、deliveryMode、onDeliveryModeChange",
  ],
  events: [
    "onEdit(id,text)、onRemove(id)、onSendNow(id)。",
    "多条默认折叠；Enter保存、Escape取消；交付模式作用于下次交付。",
  ],
  composition: ["Button、Textarea、Field、DropdownMenu、Badge"],
  consumers: ["ConversationComposer dock"],
  viewport: { width: 800, height: 400 },
  states: [
    {
      id: "paused",
      name: "停止后继续",
      condition: "当前工作停止，队列仍有未处理消息。",
      expected: "仍可展开、编辑、移除或发送此消息，不会成为无法处理的残留。",
      render: () => <Example count={2} running={false} />,
    },
    {
      id: "single",
      name: "单条",
      condition: "一条队列消息",
      expected: "直接显示内容和附件，可编辑删除与立即发送。",
      render: () => <Example count={1} />,
    },
    {
      id: "multiple",
      name: "多条折叠",
      condition: "两条消息",
      expected: "计数头可展开，交付模式有反馈，删除全部后隐藏。",
      render: () => <Example count={2} />,
    },
  ],
} satisfies CatalogEntry
