import { Message, MessageContent } from "@/components/ui/message"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import type {
  ConversationMessage,
  MessageAttachment,
} from "../conversation-types"
import { MessageActions } from "./message-actions"
import { MessageAttachments } from "./message-attachments"
import "./messages.css"

export function UserMessage({
  message,
  onOpenAttachment,
}: {
  message: ConversationMessage
  onOpenAttachment?: (attachment: MessageAttachment) => void
}) {
  return (
    <Message align="end" aria-label="用户消息" className="conversation-message">
      <MessageContent className="conversation-user-content">
        <MessageAttachments
          attachments={message.attachments ?? []}
          onOpenAttachment={onOpenAttachment}
        />
        {message.text && (
          <Bubble
            variant="muted"
            align="end"
            className="conversation-user-bubble"
          >
            <BubbleContent>{message.text}</BubbleContent>
          </Bubble>
        )}
        {message.status === "sending" && (
          <span className="sr-only" role="status">
            正在确认发送
          </span>
        )}
        <MessageActions text={message.text} time={message.time} align="end" />
      </MessageContent>
    </Message>
  )
}
