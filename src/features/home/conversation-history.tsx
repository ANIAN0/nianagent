import type { FeedbackDescription } from "@/lib/operation-issue"
import { useState } from "react"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { ConversationGroup } from "./conversation-group"
import { ConversationListFeedback } from "./conversation-list-feedback"
import type { HistoryState } from "@/features/conversation/conversation-catalog-service"
import type { ComposerData, Conversation } from "@/lib/composer/types"
export type ConversationHistoryProps = {
  data: Pick<ComposerData, "conversations" | "workspaces">
  activeConversationId?: string
  onNew?: (workspaceId: string) => void
  onSelect: (conversation: Conversation) => void
  historyState?: HistoryState
  historyError?: string
  historyIssue?: FeedbackDescription
  onHistoryRetry?: () => void
}
export function ConversationHistory({
  data,
  onSelect,
  activeConversationId,
  onNew,
  historyState = "ready",
  historyError,
  historyIssue,
  onHistoryRetry,
}: ConversationHistoryProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const workspaces = [...data.workspaces]
  for (const item of data.conversations) {
    if (
      item.cwd &&
      !workspaces.some((workspace) => workspace.id === item.workspaceId)
    )
      workspaces.push({
        id: item.workspaceId,
        path: item.cwd,
        name: item.cwd.split(/[\\/]/).filter(Boolean).at(-1) || item.cwd,
      })
  }
  const visible = data.conversations
  return (
    <nav aria-label="历史会话" className="min-h-0 flex-1 overflow-y-auto">
      <ConversationListFeedback
        state={historyState}
        error={historyError}
        issue={historyIssue}
        hasItems={visible.length > 0}
        onRetry={onHistoryRetry}
      />
      {workspaces.map((workspace) => {
        const items = visible.filter(
          (item) => item.workspaceId === workspace.id
        )
        if (!items.length) return null
        return (
          <ConversationGroup
            key={workspace.id}
            workspace={workspace}
            activeConversationId={activeConversationId}
            onNew={onNew}
            conversations={items}
            expanded={!collapsed.includes(workspace.id)}
            onSelect={onSelect}
            onToggle={() =>
              setCollapsed((current) =>
                current.includes(workspace.id)
                  ? current.filter((id) => id !== workspace.id)
                  : [...current, workspace.id]
              )
            }
          />
        )
      })}
      {!visible.length && historyState === "ready" && (
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
