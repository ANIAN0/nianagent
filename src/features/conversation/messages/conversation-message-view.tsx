import type { ReactNode } from "react"
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
  onFork,
  forkDisabledReason,
  forkPending,
  forkFeedback,
}: {
  message: ConversationMessage
  onRetry?: () => void
  onOpenAttachment?: (attachment: MessageAttachment) => void
  workspacePath?: string
  onFork?: () => void
  forkDisabledReason?: string
  forkPending?: boolean
  forkFeedback?: ReactNode
}) {
  return message.role === "user" ? (
    <UserMessage
      message={message}
      onOpenAttachment={onOpenAttachment}
      workspacePath={workspacePath}
    />
  ) : (
    <div className="flex min-w-0 flex-col gap-3">
      <AssistantMessage
        message={message}
        onRetry={onRetry}
        onOpenAttachment={onOpenAttachment}
        onFork={onFork}
        forkDisabledReason={forkDisabledReason}
        forkPending={forkPending}
      />
      {forkFeedback}
    </div>
  )
}
