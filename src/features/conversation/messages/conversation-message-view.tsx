import type {
  ConversationMessage,
  MessageAttachment,
} from "../conversation-types"
import { UserMessage } from "./user-message"
import { AssistantMessage } from "./assistant-message"

export function ConversationMessageView({
  message,
  onRetry,
  onOpenAttachment,
}: {
  message: ConversationMessage
  onRetry?: () => void
  onOpenAttachment?: (attachment: MessageAttachment) => void
}) {
  return message.role === "user" ? (
    <UserMessage message={message} onOpenAttachment={onOpenAttachment} />
  ) : (
    <AssistantMessage
      message={message}
      onRetry={onRetry}
      onOpenAttachment={onOpenAttachment}
    />
  )
}
