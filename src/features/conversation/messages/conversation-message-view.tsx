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
  workspacePath,
}: {
  message: ConversationMessage
  onRetry?: () => void
  onOpenAttachment?: (attachment: MessageAttachment) => void
  workspacePath?: string
}) {
  return message.role === "user" ? (
    <UserMessage message={message} onOpenAttachment={onOpenAttachment} workspacePath={workspacePath} />
  ) : (
    <AssistantMessage
      message={message}
      onRetry={onRetry}
      onOpenAttachment={onOpenAttachment}
    />
  )
}
