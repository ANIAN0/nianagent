import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ConversationMessageView } from "./conversation-message-view"
import { ForkFeedback } from "../controls/fork-feedback"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
export default {
  id: "conversation-message-view",
  name: "对话消息行",
  layer: "复合组件",
  group: "对话消息",
  source: "src/features/conversation/messages/conversation-message-view.tsx",
  description: "根据角色选择正式用户消息或Agent回复，供滚动列表复用。",
  boundary:
    "不持有会话状态，不执行发送或工具。结构化错误由历史项的 OperationFeedback 呈现；没有实际内容的失败回复不生成空消息。",
  inputs: [
    "message: ConversationMessage",
    "forkFeedback?: ReactNode",
    "forkPending/forkDisabledReason",
  ],
  events: ["onRetry", "onOpenAttachment", "onFork"],
  composition: [
    "UserMessage",
    "AssistantMessage",
    "来源回复的可选 forkFeedback 槽",
  ],
  consumers: ["ConversationThread", "LiveConversationView"],
  viewport: { width: 780, height: 400 },
  states: [
    {
      id: "empty-provider-failure",
      name: "提供方失败且没有回复内容",
      condition: "正式失败条目没有正文、思考或工具结果。",
      expected:
        "仅呈现所属历史项的安全原因与诊断，不生成空回复或第二条错误标记。",
      render: () => (
        <div className="p-6">
          <ConversationMessageView
            message={{
              id: "failed-empty",
              role: "assistant",
              status: "failed",
              text: "",
              issue: {
                code: "model_authentication",
                summary: "模型认证失败，请检查连接凭据。",
                severity: "error",
                recovery: "settings",
              },
            }}
          />
          <OperationFeedback
            title="此条回复未完成"
            message="模型认证失败，请检查连接凭据。"
            details="提供方状态：HTTP 401。"
          />
        </div>
      ),
    },
    {
      id: "turn",
      name: "一轮对话",
      condition: "用户与Agent消息",
      expected: "用户右对齐、Agent沿阅读轴左对齐。",
      render: () => (
        <div className="flex flex-col gap-6 p-6">
          <ConversationMessageView
            message={{
              id: "user",
              role: "user",
              status: "settled",
              text: "请检查当前项目结构。",
            }}
          />
          <ConversationMessageView
            message={{
              id: "assistant",
              role: "assistant",
              status: "settled",
              text: "当前项目按功能分组，首页和对话页面各自维护组件。",
            }}
          />
        </div>
      ),
    },
    {
      id: "fork-unknown",
      name: "原回复的分支结果待确认",
      condition: "某条已完成回复派生后未能确认结果",
      expected: "反馈归属该回复；保留创建结果检查入口，不出现在普通输入区。",
      render: () => (
        <div className="flex flex-col gap-6 p-6">
          <ConversationMessageView
            message={{
              id: "earlier-reply",
              entryId: "earlier-entry",
              role: "assistant",
              status: "settled",
              text: "这一条回复是会话分支的来源。",
            }}
            forkFeedback={
              <ForkFeedback
                operation={{
                  id: "unknown-fork",
                  sessionId: "catalog-session",
                  kind: "fork",
                  status: "unknown",
                  anchorId: "earlier-entry",
                  createdAt: "2026-10-03T09:20:00Z",
                  updatedAt: "2026-10-03T09:20:00Z",
                  error: "",
                }}
                onCheck={() => {}}
              />
            }
          />
          <ConversationMessageView
            message={{
              id: "later-reply",
              role: "assistant",
              status: "settled",
              text: "后续回复继续保留，不重复展示此前的分支提示。",
            }}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
