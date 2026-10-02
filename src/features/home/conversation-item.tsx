import { Button } from "@/components/ui/button"
import type { Conversation } from "./home-types"
import {
  ConversationStatusMark,
  conversationStatusLabels,
} from "./conversation-status-mark"

export function ConversationItem({
  conversation,
  active = false,
  onSelect,
}: {
  active?: boolean
  conversation: Conversation
  onSelect: (conversation: Conversation) => void
}) {
  return (
    <Button
      variant="ghost"
      className="relative h-8 w-full justify-start rounded-lg pl-7 text-sm font-normal data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
      aria-current={active ? "page" : undefined}
      data-active={active}
      title={`${conversation.title} · ${conversationStatusLabels[conversation.status ?? "idle"]}`}
      onClick={() => onSelect(conversation)}
    >
      <span className="absolute left-2 flex size-3 items-center justify-center">
        <ConversationStatusMark status={conversation.status ?? "idle"} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">
        {conversation.title}
      </span>
      {conversation.updatedLabel && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {conversation.updatedLabel}
        </span>
      )}
    </Button>
  )
}
