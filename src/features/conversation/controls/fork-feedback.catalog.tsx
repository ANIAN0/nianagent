import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import type { ConversationControlOperation } from "@/features/models/model-contract.generated"
import { ForkFeedback } from "./fork-feedback"
const operation: ConversationControlOperation = {
  id: "catalog-fork",
  kind: "fork",
  sessionId: "catalog-source",
  targetSessionId: "catalog-target",
  status: "completed",
  createdAt: "2026-10-03T09:20:00Z",
  updatedAt: "2026-10-03T09:20:00Z",
  error: "",
}
export default {
  id: "fork-feedback",
  name: "会话分支结果",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/controls/fork-feedback.tsx",
  description: "派生完成、失败和结果未知的就近反馈。",
  boundary: "未知只查询原标识；展示不创建会话或调用模型。",
  inputs: ["operation/error"],
  events: ["onCheck/onOpen(targetSessionId)"],
  composition: ["Alert、Button"],
  consumers: ["LiveConversationView"],
  viewport: { width: 760, height: 320 },
  states: [
    {
      id: "completed",
      name: "已完成",
      condition: "新会话已持久化",
      expected: "可以打开Host返回的新会话。",
      render: () => (
        <div className="p-6">
          <ForkFeedback
            operation={operation}
            onCheck={() => {}}
            onOpen={() => {}}
          />
        </div>
      ),
    },
    {
      id: "unknown",
      name: "结果待确认",
      condition: "原请求回执未确认",
      expected: "显示查询，不提供再次创建。",
      render: () => (
        <div className="p-6">
          <ForkFeedback
            operation={{
              ...operation,
              status: "unknown",
              error: "分支历史已创建，目录提交结果待确认。",
            }}
            onCheck={() => {}}
          />
        </div>
      ),
    },
    {
      id: "failed",
      name: "明确失败",
      condition: "请求未接受",
      expected: "保留来源及草稿并说明原因。",
      render: () => (
        <div className="p-6">
          <ForkFeedback
            operation={{
              ...operation,
              status: "failed",
              error: "请选择工具执行后的已完成回复。",
            }}
            onCheck={() => {}}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
