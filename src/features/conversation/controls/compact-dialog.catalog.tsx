import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import type { ConversationControlOperation } from "@/features/models/model-contract.generated"
import { CompactDialog } from "./compact-dialog"
function Example({
  status,
}: {
  status?: ConversationControlOperation["status"]
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
      onOpenChange={setOpen}
      onFocusChange={setFocus}
      onStart={() => setPhase("running")}
      onCancel={() => setPhase("cancelled")}
      onCheck={() => setPhase("completed")}
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
    "operation/error/pending/disabledReason",
  ],
  events: ["onStart/onCancel/onCheck", "onFocusChange/onOpenChange"],
  composition: ["Dialog、FieldGroup、Field、Textarea、Alert、Button"],
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
      id: "unknown",
      name: "结果待确认",
      condition: "回执未知",
      expected: "查询原请求，不重复提交。",
      render: () => <Example status="unknown" />,
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
