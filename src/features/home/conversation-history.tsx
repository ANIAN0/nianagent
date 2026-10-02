import { useState } from "react"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { ConversationGroup } from "./conversation-group"
import type { HomeData, Conversation } from "./home-types"
export type ConversationHistoryProps = {
  data: Pick<HomeData, "conversations" | "workspaces">
  onNew?: (workspaceId: string) => void
  onSelect: (conversation: Conversation) => void
}
export function ConversationHistory({
  data,
  onSelect,
  onNew,
}: ConversationHistoryProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const visible = data.conversations.filter((item) =>
    data.workspaces.some((workspace) => workspace.id === item.workspaceId)
  )
  return (
    <nav aria-label="历史会话" className="min-h-0 flex-1 overflow-y-auto">
      {data.workspaces.map((workspace) => {
        const items = visible.filter(
          (item) => item.workspaceId === workspace.id
        )
        if (!items.length) return null
        return (
          <ConversationGroup
            key={workspace.id}
            workspace={workspace}
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
      {!visible.length && (
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
