import type { FeedbackDescription } from "@/lib/operation-issue"
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { ConversationGroup } from "./conversation-group"
import { ConversationListFeedback } from "./conversation-list-feedback"
import {
  loadHistoryLayout,
  saveHistoryLayout,
  conversationHasPending,
  conversationIsRunning,
  type HistoryLayout,
} from "./conversation-history-layout"
import type { HistoryState } from "@/lib/submission/conversation-handoff"
import type {
  ComposerData,
  Conversation,
  Workspace,
} from "@/lib/composer/types"
import type { ConversationRowActions } from "./conversation-row-menu"
export type ConversationHistoryPosition = {
  scrollTop: number
  activeId?: string
}

export type ConversationHistoryProps = {
  position?: {
    read: () => ConversationHistoryPosition
    update: (patch: Partial<ConversationHistoryPosition>) => void
  }
  data: Pick<ComposerData, "conversations" | "workspaces">
  activeConversationId?: string
  onNew?: (workspaceId: string) => void
  onSelect: (conversation: Conversation) => void
  actions?: ConversationRowActions
  onSearchWorkspace?: (workspace: Workspace) => void
  historyState?: HistoryState
  historyError?: string
  historyIssue?: FeedbackDescription
  onHistoryRetry?: () => void
}

type ConversationGroupData = {
  workspace: Workspace
  items: Conversation[]
}

// 组内条目已按最后更新时间倒序，首位即组内最新活动；组间按同一活动排序。
function groupByWorkspace(
  workspaces: Workspace[],
  conversations: Conversation[],
  includeEmpty: boolean
): ConversationGroupData[] {
  const known = new Map(
    workspaces.map((workspace) => [workspace.id, workspace])
  )
  const buckets = new Map<string, Conversation[]>(
    includeEmpty ? workspaces.map((workspace) => [workspace.id, []]) : []
  )
  for (const conversation of conversations) {
    if (conversation.cwd && !known.has(conversation.workspaceId))
      known.set(conversation.workspaceId, {
        id: conversation.workspaceId,
        path: conversation.cwd,
        name:
          conversation.cwd.split(/[\\/]/).filter(Boolean).at(-1) ||
          conversation.cwd,
      })
    const bucket = buckets.get(conversation.workspaceId)
    if (bucket) bucket.push(conversation)
    else buckets.set(conversation.workspaceId, [conversation])
  }
  return [...buckets.entries()]
    .flatMap(([id, items]) => {
      const workspace = known.get(id)
      return workspace ? [{ workspace, items }] : []
    })
    .sort(
      (a, b) =>
        activityOf(b.items[0]) - activityOf(a.items[0]) ||
        a.workspace.name.localeCompare(b.workspace.name)
    )
}

function activityOf(conversation: Conversation | undefined) {
  const time = Date.parse(conversation?.updatedAt ?? "")
  return Number.isFinite(time) ? time : 0
}

export function ConversationHistory({
  data,
  position,
  onSelect,
  activeConversationId,
  onNew,
  actions,
  onSearchWorkspace,
  historyState = "ready",
  historyError,
  historyIssue,
  onHistoryRetry,
}: ConversationHistoryProps) {
  const [layout, setLayout] = useState<HistoryLayout>(loadHistoryLayout)
  useEffect(() => {
    saveHistoryLayout(layout)
  }, [layout])
  const nav = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (nav.current && position)
      nav.current.scrollTop = position.read().scrollTop
  }, [position])
  // 选中变化（含搜索/跨视图跳转）时把活动行滚入视野；
  // 分组展开与水位抬升已由 activeConversationId 派生。
  useEffect(() => {
    if (position && position.read().activeId === activeConversationId) return
    position?.update({ activeId: activeConversationId })
    if (!activeConversationId) return
    const frame = requestAnimationFrame(() => {
      nav.current
        ?.querySelector<HTMLElement>(
          `[data-conversation-id="${CSS.escape(activeConversationId)}"]`
        )
        ?.scrollIntoView({ block: "nearest" })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeConversationId, position])
  const { workspaces, conversations } = data
  const groups = useMemo(
    () => groupByWorkspace(workspaces, conversations, historyState === "ready"),
    [workspaces, conversations, historyState]
  )
  const activity = useMemo(() => {
    let pending = 0
    let running = 0
    for (const item of conversations) {
      if (conversationHasPending(item)) pending++
      if (conversationIsRunning(item)) running++
    }
    return { pending, running }
  }, [conversations])
  const toggle = (workspaceId: string, collapsing: boolean) =>
    setLayout((current) => {
      const watermark = { ...current.watermark }
      // 折叠组重置水位，与重新展开时的默认视图一致。
      if (collapsing) delete watermark[workspaceId]
      return {
        collapsed: collapsing
          ? [...current.collapsed, workspaceId]
          : current.collapsed.filter((id) => id !== workspaceId),
        watermark,
      }
    })
  const raise = (workspaceId: string, value: number) =>
    setLayout((current) => ({
      ...current,
      watermark: { ...current.watermark, [workspaceId]: value },
    }))
  const lower = (workspaceId: string) =>
    setLayout((current) => {
      const watermark = { ...current.watermark }
      delete watermark[workspaceId]
      return { ...current, watermark }
    })
  function navigateRows(event: KeyboardEvent<HTMLElement>) {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    )
      return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const rows = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[data-conversation-id]:not([aria-disabled="true"]):not(:disabled)'
      ),
    ].filter((row) => row.getClientRects().length > 0)
    const current = rows.findIndex((row) => row.contains(target))
    if (current < 0) return
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : Math.max(
              0,
              Math.min(
                rows.length - 1,
                current + (event.key === "ArrowDown" ? 1 : -1)
              )
            )
    event.preventDefault()
    rows[next]?.focus()
  }
  return (
    <nav
      ref={nav}
      aria-label="历史会话"
      onKeyDown={navigateRows}
      onScroll={(event) => {
        position?.update({ scrollTop: event.currentTarget.scrollTop })
      }}
      className="moon-scrollbar mt-3 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
    >
      <ConversationListFeedback
        state={historyState}
        error={historyError}
        issue={historyIssue}
        hasItems={conversations.length > 0}
        onRetry={onHistoryRetry}
      />
      {(activity.pending > 0 || activity.running > 0) && (
        <div
          className="mb-2 flex flex-wrap gap-x-3 px-2 text-xs text-muted-foreground"
          role="status"
        >
          {activity.pending > 0 && <span>待处理 {activity.pending}</span>}
          {activity.running > 0 && <span>运行中 {activity.running}</span>}
        </div>
      )}
      {groups.map(({ workspace, items }) => (
        <ConversationGroup
          key={workspace.id}
          workspace={workspace}
          conversations={items}
          expanded={
            !layout.collapsed.includes(workspace.id) ||
            items.some((item) => item.id === activeConversationId)
          }
          watermark={layout.watermark[workspace.id] ?? 0}
          activeConversationId={activeConversationId}
          onNew={onNew}
          onSelect={onSelect}
          actions={actions}
          onToggle={(collapsing) => toggle(workspace.id, collapsing)}
          onShowMore={(value) => raise(workspace.id, value)}
          onShowLess={() => lower(workspace.id)}
          onBrowse={onSearchWorkspace && (() => onSearchWorkspace(workspace))}
        />
      ))}
      {!groups.length && historyState === "ready" && (
        <Empty className="px-2 py-8">
          <EmptyHeader>
            <EmptyTitle className="text-sm font-normal">暂无会话</EmptyTitle>
            <EmptyDescription>从新建会话开始。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </nav>
  )
}
