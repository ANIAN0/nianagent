import { useState } from "react"
import { ConversationItem } from "./conversation-item"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { conversationStatusLabels } from "./conversation-status-mark"
import type { ConversationStatus } from "./home-types"
function StatusExamples() {
  const [read, setRead] = useState<string[]>([])
  return (
    <div className="p-3">
      {(Object.keys(conversationStatusLabels) as ConversationStatus[]).map(
        (status) => (
          <ConversationItem
            key={status}
            conversation={{
              id: status,
              workspaceId: "demo",
              title: conversationStatusLabels[status],
              updatedLabel: "刚刚",
              status:
                read.includes(status) &&
                (status === "completed" || status === "failed")
                  ? "idle"
                  : status,
            }}
            onSelect={() => setRead((previous) => [...previous, status])}
          />
        )
      )}
    </div>
  )
}
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
  composition: ["Button、ConversationStatusMark"],
  consumers: ["ConversationGroup"],
  viewport: { width: 300, height: 220 },
  states: [
    {
      id: "statuses",
      name: "会话状态与未读",
      condition: "运行、停止中、待回答及未读结果。",
      expected:
        "状态位不挤动标题；打开完成或失败结果后清除未读点，待回答仍保留。",
      render: () => <StatusExamples />,
    },
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
