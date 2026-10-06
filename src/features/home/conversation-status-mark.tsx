import { HoverHint } from "@/components/feedback/hover-hint"
import { Circle, LoaderCircle } from "lucide-react"
import type { ConversationStatus } from "./home-types"

export const conversationStatusLabels: Record<ConversationStatus, string> = {
  idle: "空闲",
  running: "运行中",
  stopping: "正在停止",
  waiting: "待回答",
  completed: "回复结束",
  failed: "回复失败",
}
export function conversationStatusLabel(
  status: ConversationStatus,
  unread?: boolean
) {
  const terminal = status === "completed" || status === "failed"
  return `${terminal && unread !== false ? "未读：" : ""}${conversationStatusLabels[status]}`
}

export function ConversationStatusMark({
  status,
  unread,
}: {
  status: ConversationStatus
  unread?: boolean
}) {
  if (
    status === "idle" ||
    (unread === false && (status === "completed" || status === "failed"))
  )
    return null
  const spinning = status === "running" || status === "stopping"
  return (
    <HoverHint
      content={conversationStatusLabel(status, unread)}
      label={conversationStatusLabel(status, unread)}
    >
      <span
        className="conversation-status-mark"
        data-status={status}
        role="img"
        aria-label={conversationStatusLabel(status, unread)}
      >
        {spinning ? (
          <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
        ) : (
          <Circle aria-hidden />
        )}
      </span>
    </HoverHint>
  )
}
