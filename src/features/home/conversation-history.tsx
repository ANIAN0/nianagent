import type { FeedbackDescription } from "@/lib/operation-issue"
import { useEffect, useMemo, useRef, useState } from "react"
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
  type HistoryLayout,
} from "./conversation-history-layout"
import type { HistoryState } from "@/lib/submission/conversation-handoff"
import type {
  ComposerData,
  Conversation,
  Workspace,
} from "@/lib/composer/types"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ConversationRowActions } from "./conversation-row-menu"
export type ConversationHistoryProps = {
  data: Pick<ComposerData, "conversations" | "workspaces">
  activeConversationId?: string
  onNew?: (workspaceId: string) => void
  onSelect: (conversation: Conversation) => void
  actions?: ConversationRowActions
  archivedView?: boolean
  onLeaveArchivedView?: () => void
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
  conversations: Conversation[]
): ConversationGroupData[] {
  const known = new Map(
    workspaces.map((workspace) => [workspace.id, workspace])
  )
  const buckets = new Map<string, Conversation[]>()
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
  onSelect,
  activeConversationId,
  onNew,
  actions,
  archivedView = false,
  onLeaveArchivedView,
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
  // 选中变化（含搜索/跨视图跳转）时把活动行滚入视野；
  // 分组展开与水位抬升已由 activeConversationId 派生。
  useEffect(() => {
    if (!activeConversationId) return
    const frame = requestAnimationFrame(() => {
      nav.current
        ?.querySelector<HTMLElement>(
          `[data-conversation-id="${CSS.escape(activeConversationId)}"]`
        )
        ?.scrollIntoView({ block: "nearest" })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeConversationId])
  const { workspaces, conversations } = data
  const groups = useMemo(
    () => groupByWorkspace(workspaces, conversations),
    [workspaces, conversations]
  )
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
  return (
    <nav
      ref={nav}
      aria-label="历史会话"
      className="moon-scrollbar mt-3 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
    >
      <ConversationListFeedback
        state={historyState}
        error={historyError}
        issue={historyIssue}
        hasItems={conversations.length > 0}
        onRetry={onHistoryRetry}
      />
      {archivedView && (
        <div className="mb-1 flex items-center gap-1 px-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="返回活跃会话"
            onClick={onLeaveArchivedView}
          >
            <ArrowLeft />
          </Button>
          <span className="flex-1 text-xs text-muted-foreground">
            已归档会话
          </span>
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
          onNew={archivedView ? undefined : onNew}
          onSelect={onSelect}
          actions={actions}
          onToggle={(collapsing) => toggle(workspace.id, collapsing)}
          onShowMore={(value) => raise(workspace.id, value)}
          onShowLess={() => lower(workspace.id)}
        />
      ))}
      {!conversations.length && historyState === "ready" && (
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
