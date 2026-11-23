import type { Conversation } from "@/lib/composer/types"

// 侧栏历史区的持久化布局：分组折叠与水位线。
// 折叠侧栏会卸载列表组件，状态必须经 localStorage 存活。
const layoutKey = "moon.history.groups.v1"

export type HistoryLayout = {
  /** 用户手动折叠的工作区组。 */
  collapsed: string[]
  /** 用户用"显示更多"抬升的水位（按组覆盖默认值）。 */
  watermark: Record<string, number>
}

export const HISTORY_BASE_ROWS = 5
export const HISTORY_STEP_ROWS = 5
export const HISTORY_MAX_ROWS = 50

function readLayout(): HistoryLayout {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(layoutKey) ?? "null")
    if (!saved || typeof saved !== "object")
      return { collapsed: [], watermark: {} }
    const source = saved as {
      collapsed?: unknown
      watermark?: unknown
    }
    return {
      collapsed: Array.isArray(source.collapsed)
        ? source.collapsed.filter((id): id is string => typeof id === "string")
        : [],
      watermark: readWatermark(source.watermark),
    }
  } catch {
    return { collapsed: [], watermark: {} }
  }
}

function readWatermark(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] =>
      typeof entry[0] === "string" &&
      typeof entry[1] === "number" &&
      Number.isSafeInteger(entry[1])
  )
  return Object.fromEntries(entries)
}

export function loadHistoryLayout(): HistoryLayout {
  return readLayout()
}

export function saveHistoryLayout(layout: HistoryLayout) {
  try {
    localStorage.setItem(layoutKey, JSON.stringify(layout))
  } catch {
    /* 持久化失败时布局退化为会话内状态。 */
  }
}

export function conversationHasPending(conversation: Conversation) {
  return !!(
    conversation.pending?.approvals ||
    conversation.pending?.answers ||
    conversation.status === "waiting"
  )
}

export function conversationIsRunning(conversation: Conversation) {
  return conversation.status === "running" || conversation.status === "stopping"
}

/** 运行中/待交互/未读完成/当前打开的行需要抬升水位保持可见。 */
export function isAttentionRow(conversation: Conversation, activeId?: string) {
  if (conversation.id === activeId) return true
  if (conversationHasPending(conversation)) return true
  const status = conversation.status
  if (conversationIsRunning(conversation)) return true
  return (
    (status === "completed" || status === "failed") &&
    conversation.unread !== false
  )
}

/** 注意力行必须可见：返回从列表头到最后一行注意力的行数。 */
export function attentionRowCount(
  conversations: Conversation[],
  activeId?: string
) {
  let count = 0
  for (const [index, conversation] of conversations.entries())
    if (isAttentionRow(conversation, activeId)) count = index + 1
  return count
}
