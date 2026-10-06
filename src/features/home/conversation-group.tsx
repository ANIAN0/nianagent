import { HoverHint } from "@/components/feedback/hover-hint"
import { ConversationItem } from "./conversation-item"
import { ChevronDown, FolderOpen, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Workspace, Conversation } from "./home-types"
export type ConversationGroupProps = {
  workspace: Workspace
  conversations: Conversation[]
  expanded: boolean
  activeConversationId?: string
  onNew?: (workspaceId: string) => void
  onToggle: () => void
  onSelect: (conversation: Conversation) => void
}
export function ConversationGroup({
  workspace,
  conversations,
  expanded,
  onToggle,
  onNew,
  onSelect,
  activeConversationId,
}: ConversationGroupProps) {
  return (
    <section className="mb-2">
      <div className="group/directory flex items-center">
        <Button
          variant="section"
          className="h-8 min-w-0 flex-1 justify-start text-sm font-normal"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="relative size-4">
            <FolderOpen className="size-4 group-hover/directory:opacity-0" />
            <ChevronDown
              className={cn(
                "absolute inset-0 size-4 opacity-0 group-hover/directory:opacity-100",
                !expanded && "-rotate-90"
              )}
            />
          </span>
          <HoverHint content={workspace.path}>
            <span className="min-w-0 flex-1 truncate text-left">
              {workspace.name}
            </span>
          </HoverHint>
        </Button>
        {onNew && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0 group-hover/directory:opacity-100 focus-visible:opacity-100"
            aria-label={`在 ${workspace.name} 中新建会话`}
            onClick={() => onNew(workspace.id)}
          >
            <Plus />
          </Button>
        )}
      </div>
      {expanded && (
        <ul className="mt-1 flex flex-col">
          {conversations.map((item) => (
            <li key={item.id}>
              <ConversationItem
                conversation={item}
                active={item.id === activeConversationId}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
