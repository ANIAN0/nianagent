import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import type { ConversationControlOperation } from "@/features/models/model-contract.generated"
import { CompactDialog } from "./compact-dialog"
import type { ConversationControlAction } from "./use-conversation-controls"
function Example({
  status,
  error,
  errorAction,
  uncertain,
}: {
  status?: ConversationControlOperation["status"]
  error?: string
  errorAction?: ConversationControlAction
  uncertain?: boolean
}) {
  const [open, setOpen] = useState(true)
  const [focus, setFocus] = useState("保留工作目标、已验证结论和待处理事项。")
  const [phase, setPhase] = useState(status)
  const now = "2026-10-03T09:20:00Z"
  return (
    <CompactDialog
      open={open}
      title="核对当前项目的启动与任务执行"
      model="DeepSeek-V4-Flash"
      messageCount={28}
      focus={focus}
      operation={
        phase
          ? {
              id: "catalog-compact",
              sessionId: "catalog-session",
              kind: "compact",
              status: phase,
              createdAt: now,
              updatedAt: now,
              focus,
              error:
                phase === "failed" ? "历史内容不足，尚无可压缩的内容。" : "",
            }
          : undefined
      }
      issue={
        error ? { message: error, action: errorAction, uncertain } : undefined
      }
      onOpenChange={setOpen}
      onFocusChange={setFocus}
      onStart={() => setPhase("running")}
      onCancel={() => setPhase("cancelling")}
      onCheck={() =>
        setPhase(phase === "cancelling" ? "cancelled" : "completed")
      }
    />
  )
}
export default {
  id: "compact-dialog",
  name: "手动压缩",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/controls/compact-dialog.tsx",
  description: "上下文面板与/compact共用的压缩操作面板。",
  boundary:
    "操作由会话控制服务拥有；离开面板不取消，取消只针对本次压缩。展示不调用模型。",
  inputs: [
    "title/model/messageCount/focus",
    "operation/issue/pending/pendingAction/disabledReason",
  ],
  events: ["onStart/onCancel/onCheck", "onFocusChange/onOpenChange"],
  composition: [
    "Dialog、FieldGroup、Field、Textarea、OperationFeedback、Button",
  ],
  consumers: ["LiveConversationView"],
  viewport: { width: 900, height: 650 },
  states: [
    {
      id: "ready",
      name: "开始前",
      condition: "会话空闲",
      expected: "保留重点可选，开始前取消不改草稿。",
      render: () => <Example />,
    },
    {
      id: "running",
      name: "压缩进行中",
      condition: "操作已接受",
      expected: "重点只读，支持返回会话、查询和专属取消。",
      render: () => <Example status="running" />,
    },
    {
      id: "cancelling",
      name: "正在取消",
      condition: "取消请求已接受但结果未确认",
      expected: "重点保持只读，不重复取消；检查后显示实际结果。",
      render: () => <Example status="cancelling" />,
    },
    {
      id: "unknown",
      name: "结果待确认",
      condition: "回执未知",
      expected: "静态提示结果待确认，无假进行中旋转；查询原请求，不重复提交。",
      render: () => <Example status="unknown" />,
    },
    {
      id: "check-failed",
      name: "检查结果失败",
      condition: "结果未知且查询连接失败",
      expected: "同一处提示无法确认，重点保留，可再次检查原操作。",
      render: () => (
        <Example
          status="unknown"
          error="暂时无法连接服务，请稍后检查压缩结果。"
          errorAction="check"
        />
      ),
    },
    {
      id: "cancel-failed",
      name: "取消请求失败",
      condition: "取消未被接受，压缩仍在进行",
      expected: "反馈归属取消动作，不声称已取消，保留检查与取消入口。",
      render: () => (
        <Example
          status="running"
          error="取消请求未确认，请先检查压缩状态。"
          errorAction="cancel"
        />
      ),
    },
    {
      id: "cancel-unknown",
      name: "取消结果待确认",
      condition: "压缩原本运行中，取消请求传输回执丢失",
      expected:
        "静态提示取消结果待确认，只能检查原操作；不重复取消，不假称取消成功。",
      render: () => (
        <Example
          status="running"
          error="取消请求未确认，请先检查压缩状态。"
          errorAction="cancel"
          uncertain
        />
      ),
    },
    {
      id: "cancelled",
      name: "已取消",
      condition: "服务确认未保存摘要且压缩已结束",
      expected: "普通状态反馈，原重点保留并可重新开始，不显示红色错误。",
      render: () => <Example status="cancelled" />,
    },
    {
      id: "failed",
      name: "失败保留重点",
      condition: "明确失败",
      expected: "原因就近显示，可重新压缩。",
      render: () => <Example status="failed" />,
    },
    {
      id: "completed",
      name: "已完成",
      condition: "摘要已保存",
      expected: "显示实际完成，用量待更新。",
      render: () => <Example status="completed" />,
    },
  ],
} satisfies CatalogEntry
