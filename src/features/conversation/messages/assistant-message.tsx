import type {
  ConversationMessage,
  MessageAttachment,
} from "../conversation-types"
import { ConversationTurnView } from "./conversation-turn-view"
import { messageText } from "../conversation-turns"
import "./messages.css"

/** Standalone reply previews use the same block and tail presentation as the formal list. */
export function AssistantMessage({
  message,
  onRetry,
  onOpenAttachment,
  onFork,
  forkDisabledReason,
  forkPending,
  showActions = true,
}: {
  message: ConversationMessage
  onRetry?: () => void
  onOpenAttachment?: (attachment: MessageAttachment) => void
  onFork?: () => void
  forkDisabledReason?: string
  forkPending?: boolean
  showActions?: boolean
}) {
  const hasContent =
    message.text.trim() ||
    message.tools?.length ||
    message.thinking?.text ||
    message.blocks?.length ||
    message.attachments?.length
  if (message.status === "failed" && message.issue && !hasContent) return null
  return (
    <ConversationTurnView
      turn={{
        revision: 1,
        id: message.userTurnId ?? message.id,
        historyIndex: message.historyIndex ?? 0,
        messages: [message],
        tail: message,
        response: messageText(message),
      }}
      onRetry={onRetry}
      onOpenAttachment={onOpenAttachment}
      onFork={onFork}
      forkDisabledReason={forkDisabledReason}
      forkPending={forkPending}
      showActions={showActions}
    />
  )
}
