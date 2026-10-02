import { Circle, LoaderCircle } from "lucide-react"
import type { ConversationStatus } from "./home-types"

export const conversationStatusLabels: Record<ConversationStatus, string> = {
  idle: "空闲",
  running: "运行中",
  stopping: "正在停止",
  waiting: "待回答",
  completed: "未读：已完成",
  failed: "未读：执行失败",
}

export function ConversationStatusMark({
  status,
}: {
  status: ConversationStatus
}) {
  if (status === "idle") return null
  const spinning = status === "running" || status === "stopping"
  return (
    <span
      className="conversation-status-mark"
      data-status={status}
      role="img"
      aria-label={conversationStatusLabels[status]}
      title={conversationStatusLabels[status]}
    >
      {spinning ? (
        <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
      ) : (
        <Circle aria-hidden />
      )}
    </span>
  )
}
