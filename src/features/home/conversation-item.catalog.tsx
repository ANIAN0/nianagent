import { useState } from "react"
import { ConversationItem } from "./conversation-item"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({ title }: { title: string }) {
  const [selected, setSelected] = useState("")
  return (
    <div className="p-4">
      <ConversationItem
        conversation={{ id: "example", workspaceId: "demo", title }}
        onSelect={(item) => setSelected(item.title)}
      />
      <p role="status" className="mt-4 text-sm">
        {selected ? `已选择：${selected}` : "尚未选择会话"}
      </p>
    </div>
  )
}
export default {
  id: "conversation-item",
  name: "会话条目",
  layer: "复合组件",
  group: "侧栏导航",
  source: "src/features/home/conversation-item.tsx",
  description: "历史会话的标题与打开动作。",
  boundary: "不负责目录分组、搜索或路由；将完整会话返回上层。",
  props: [
    {
      name: "conversation",
      type: "Conversation",
      default: "必填",
      description: "id、workspaceId、title。",
    },
    {
      name: "onSelect",
      type: "(conversation: Conversation) => void",
      default: "必填",
      description: "调用方决定打开行为。",
    },
  ],
  inputs: ["conversation: Conversation"],
  events: ["onSelect(conversation)"],
  composition: ["Button"],
  consumers: ["ConversationGroup"],
  viewport: { width: 300, height: 220 },
  states: [
    {
      id: "default",
      name: "普通标题",
      condition: "目录中的一条历史会话。",
      expected: "鼠标和键盘均可选择，返回完整对象。",
      render: () => <Example title="检查首页布局" />,
    },
    {
      id: "long",
      name: "长标题",
      condition: "标题超过侧栏宽度。",
      expected: "单行截断，title 保留完整标题，选择反馈完整名称。",
      render: () => (
        <Example title="检查首页布局与材料管理以及模型配置的完整交互路径" />
      ),
    },
  ],
} satisfies CatalogEntry
