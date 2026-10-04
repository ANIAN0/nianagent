import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import type { ConversationControlOperation } from "@/features/models/model-contract.generated"
import { ConversationMessageView } from "../messages/conversation-message-view"
import { ForkFeedback } from "./fork-feedback"
import type { ConversationControlAction } from "./use-conversation-controls"

const operation: ConversationControlOperation = {
  id: "catalog-fork",
  kind: "fork",
  sessionId: "catalog-source",
  anchorId: "catalog-reply",
  targetSessionId: "catalog-target",
  status: "completed",
  createdAt: "2026-10-03T09:20:00Z",
  updatedAt: "2026-10-03T09:20:00Z",
  error: "",
}
function Example({
  status,
  pendingAction,
  message,
}: {
  status: ConversationControlOperation["status"]
  pendingAction?: ConversationControlAction
  message?: string
}) {
  const [phase, setPhase] = useState(status)
  const [opened, setOpened] = useState(false)
  return (
    <div className="p-6">
      <ConversationMessageView
        message={{
          id: "catalog-reply-message",
          entryId: operation.anchorId,
          role: "assistant",
          status: "settled",
          text: "首页的交互边界已核对。可以从这条回复继续探索另一种方案。",
          time: "10:20",
        }}
        onFork={() => setPhase("running")}
        forkPending={["running", "unknown"].includes(phase)}
        forkFeedback={
          <ForkFeedback
            operation={{
              ...operation,
              status: phase,
              error:
                phase === "failed"
                  ? "会话配置中有不可用的工具，请调整配置后重试。"
                  : "",
            }}
            issue={
              message
                ? {
                    message,
                    details: "读取原操作结果时连接中断，未发起新的创建请求。",
                  }
                : undefined
            }
            pending={!!pendingAction}
            pendingAction={pendingAction}
            onCheck={() => setPhase("completed")}
            onRetry={() => setPhase("running")}
            onOpen={() => setOpened(true)}
          />
        }
      />
      {opened && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          已触发打开新会话事件（演示数据）。
        </p>
      )}
    </div>
  )
}
export default {
  id: "fork-feedback",
  name: "会话分支结果",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/controls/fork-feedback.tsx",
  description: "原回复尾部的派生提交、失败与结果待确认反馈。",
  boundary:
    "未知只查询原操作；明确失败才允许重新创建。成功导航由正式页面负责，展示不创建会话。",
  inputs: ["operation/issue", "pending/pendingAction"],
  events: ["onCheck/onRetry/onOpen(targetSessionId)"],
  composition: ["OperationFeedback、Button"],
  consumers: ["LiveConversationView 的 ConversationMessageView.forkFeedback"],
  viewport: { width: 760, height: 420 },
  states: [
    {
      id: "submitting",
      name: "请求正在提交",
      condition: "正在等待创建接口回执",
      expected: "来源按钮忙碌，说明完成后自动打开；不重复创建。",
      render: () => <Example status="unknown" pendingAction="fork" />,
    },
    {
      id: "running",
      name: "正在创建",
      condition: "服务已接受操作",
      expected: "反馈紧邻原回复，等待实际结果；不占用输入区。",
      render: () => <Example status="running" />,
    },
    {
      id: "completed",
      name: "已完成",
      condition: "新会话已保存",
      expected: "正式页面直接打开新会话；返回来源时可再次打开，无新增确认。",
      render: () => <Example status="completed" />,
    },
    {
      id: "unknown",
      name: "结果待确认",
      condition: "原请求回执未确认",
      expected: "明确待确认，不称正在创建；检查原结果，不提供再次创建。",
      render: () => <Example status="unknown" />,
    },
    {
      id: "check-failed",
      name: "检查失败",
      condition: "结果待确认且原操作查询连接中断",
      expected: "原因与检查入口留在原回复下方，诊断可展开，不重复创建。",
      render: () => (
        <Example
          status="unknown"
          message="暂时无法连接服务，请稍后检查分支结果。"
        />
      ),
    },
    {
      id: "failed",
      name: "明确失败",
      condition: "服务明确未创建新会话",
      expected: "保留来源及草稿，在原回复附近说明原因并允许重新创建。",
      render: () => <Example status="failed" />,
    },
  ],
} satisfies CatalogEntry
