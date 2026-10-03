import type { CatalogEntry } from "../../../ui-catalog/catalog"
import {
  ConversationStatusMark,
  conversationStatusLabels,
} from "./conversation-status-mark"
import type { ConversationStatus } from "./home-types"

export default {
  id: "conversation-status-mark",
  name: "会话状态标识",
  layer: "复合组件",
  group: "侧栏导航",
  source: "src/features/home/conversation-status-mark.tsx",
  description:
    "10px状态位；运行使用Lucide旋转环，待回答及未读结果使用带浅晕的实心点。",
  boundary:
    "仅显示回复状态，不判断任务产物是否合格；未读判断与打开后清除由会话宿主管理。",
  inputs: [
    "status：idle / running / stopping / waiting / completed / failed；unread=false 时完成/失败标记隐藏，但不修改真实运行状态。",
  ],
  events: ["无交互；配合会话行的可访问名称及悬停说明。"],
  composition: ["Lucide Circle、LoaderCircle"],
  consumers: ["ConversationItem", "ConversationSearch"],
  viewport: { width: 300, height: 100 },
  states: [
    ...(Object.keys(conversationStatusLabels) as ConversationStatus[]).map(
      (status) => ({
        id: status,
        name: conversationStatusLabels[status],
        condition: conversationStatusLabels[status],
        expected:
          status === "idle"
            ? "空闲不显示标记。"
            : "状态可区分且有文本名称；减少动态效果时不旋转。",
        render: () => (
          <div className="flex items-center gap-3 p-6">
            <ConversationStatusMark status={status} />
            <span>{conversationStatusLabels[status]}</span>
          </div>
        ),
      })
    ),
    {
      id: "read-result",
      name: "已读结果",
      condition: "status=failed，unread=false。",
      expected: "失败状态仍保留在数据中，已读后不显示未读点。",
      render: () => (
        <div className="flex items-center gap-3 p-6">
          <ConversationStatusMark status="failed" unread={false} />
          <span>回复失败 · 已读</span>
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
