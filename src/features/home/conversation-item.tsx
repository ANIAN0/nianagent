import { Button } from "@/components/ui/button"
import type { Conversation } from "./home-types"

export function ConversationItem({
  conversation,
  onSelect,
}: {
  conversation: Conversation
  onSelect: (conversation: Conversation) => void
}) {
  return (
    <Button
      variant="ghost"
      className="h-8 w-full justify-start rounded-lg pl-7 text-sm font-normal"
      title={conversation.title}
      onClick={() => onSelect(conversation)}
    >
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
