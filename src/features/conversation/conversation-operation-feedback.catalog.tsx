import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ConversationOperationFeedback } from "./conversation-operation-feedback"

function Example({
  scenario,
}: {
  scenario:
    | "read"
    | "send"
    | "unknown"
    | "retry-unknown"
    | "cancelled"
    | "receipt"
    | "draft"
    | "stop"
}) {
  const [done, setDone] = useState(false)
  if (done) return <p role="status">对应操作已恢复，其他内容保持。</p>
  const recover = () => setDone(true)
  return (
    <div className="p-4">
      <ConversationOperationFeedback
        readIssue={
          scenario === "read"
            ? {
                message: "暂时无法读取最新会话，已显示的历史仍保留。",
                code: "operation_failed",
                recovery: "reload",
              }
            : undefined
        }
        actionIssue={
          ["send", "unknown", "retry-unknown", "cancelled", "stop"].includes(
            scenario
          )
            ? {
                action:
                  scenario === "stop"
                    ? "stop"
                    : scenario === "retry-unknown"
                      ? "retry"
                      : "send",
                code:
                  scenario === "cancelled"
                    ? "cancelled"
                    : scenario === "unknown" || scenario === "retry-unknown"
                      ? "result_unknown"
                      : "operation_failed",
                message:
                  scenario === "cancelled"
                    ? "本次操作已取消，输入内容仍保留。"
                    : scenario === "retry-unknown"
                      ? "继续请求尚未收到回执，原请求身份已保留。"
                      : scenario === "unknown"
                        ? "尚未收到发送回执，输入内容已保留。"
                        : scenario === "stop"
                          ? "停止请求未送达，当前工作可能仍在进行。"
                          : "所选模型暂时不可用，请检查模型设置。",
                details:
                  scenario === "unknown"
                    ? "传输回执未能确认；原请求身份仍保留。"
                    : undefined,
                recovery:
                  scenario === "cancelled"
                    ? "none"
                    : scenario === "send"
                      ? "settings"
                      : scenario === "unknown" || scenario === "retry-unknown"
                        ? "check"
                        : "retry",
                severity:
                  scenario === "cancelled"
                    ? "info"
                    : scenario === "unknown" || scenario === "retry-unknown"
                      ? "warning"
                      : "error",
              }
            : undefined
        }
        draftError={
          scenario === "draft"
            ? "本地存储空间不足，编辑内容仍在当前输入框。"
            : undefined
        }
        receiptIssue={
          scenario === "receipt"
            ? {
                code: "receipt_cleanup",
                message:
                  "消息已接受，本地发送记录尚未清理。请先完成本地清理再发送下一条。",
                recovery: "retry",
                severity: "warning",
              }
            : undefined
        }
        onCleanReceipt={recover}
        unconfirmed={scenario === "unknown" || scenario === "retry-unknown"}
        onReload={recover}
        onReconcile={recover}
        onSaveDraft={recover}
        onStop={recover}
        onContinue={recover}
        onOpenSettings={recover}
      />
    </div>
  )
}
export default {
  id: "conversation-operation-feedback",
  name: "会话操作反馈",
  layer: "复合组件",
  group: "会话",
  source: "src/features/conversation/conversation-operation-feedback.tsx",
  description: "读取、发送、停止与草稿分别显示原因及所属恢复动作。",
  boundary:
    "模型运行和队列的反馈由各自位置负责；这里只组合输入附近的操作反馈，不自行发请求。",
  inputs: [
    "readIssue、actionIssue、draftError、receiptIssue、unconfirmed、pending",
  ],
  events: [
    "重新读取、核对原发送、重试草稿保存、清理本地回执、再次停止、继续回复、打开模型设置",
  ],
  composition: ["OperationFeedback", "Button"],
  consumers: ["LiveConversationView"],
  viewport: { width: 700, height: 360 },
  states: [
    {
      id: "read",
      name: "读取失败",
      condition: "刷新失败并保留历史",
      expected: "只提供重新读取，不误导为再次发送。",
      render: () => <Example scenario="read" />,
    },
    {
      id: "send",
      name: "模型不可用",
      condition: "发送前模型检查未通过",
      expected: "保留输入，提供检查模型设置。",
      render: () => <Example scenario="send" />,
    },
    {
      id: "unknown",
      name: "发送待确认",
      condition: "发送回执丢失",
      expected: "静态警示，只核对原请求；诊断默认折叠。",
      render: () => <Example scenario="unknown" />,
    },
    {
      id: "draft",
      name: "草稿存储失败",
      condition: "输入保留但本机存储未成功",
      expected: "恢复动作是保存草稿，不调用模型。",
      render: () => <Example scenario="draft" />,
    },
    {
      id: "retry-unknown",
      name: "继续请求待确认",
      condition: "继续回复的回执丢失。",
      expected: "只核对原请求，不重复发起推理；以后编辑的草稿保留。",
      render: () => <Example scenario="retry-unknown" />,
    },
    {
      id: "cancelled",
      name: "操作取消",
      condition: "提交前已取消请求。",
      expected: "中性说明，不显示红色错误或重试按钮。",
      render: () => <Example scenario="cancelled" />,
    },
    {
      id: "receipt",
      name: "本地回执清理失败",
      condition: "后端接受消息，但本机回执清理失败。",
      expected: "只重试本地清理，不重复发送，也不误导为保存草稿。",
      render: () => <Example scenario="receipt" />,
    },
    {
      id: "stop",
      name: "停止失败",
      condition: "停止请求明确未完成",
      expected: "再次停止当前运行，不能误作再次发送。",
      render: () => <Example scenario="stop" />,
    },
  ],
} satisfies CatalogEntry
