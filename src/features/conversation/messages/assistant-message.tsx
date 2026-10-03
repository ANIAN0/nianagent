import { Message, MessageContent } from "@/components/ui/message"
import { Marker, MarkerContent } from "@/components/ui/marker"
import type {
  ConversationMessage,
  MessageAttachment,
} from "../conversation-types"
import { ThinkingBlock } from "./thinking-block"
import { ToolCall } from "./tool-call"
import { ExecutionProcess } from "./execution-process"
import { MarkdownContent } from "./markdown-content"
import { MessageActions } from "./message-actions"
import { MessageAttachments } from "./message-attachments"
import "./messages.css"

export function AssistantMessage({
  message,
  onRetry,
  onOpenAttachment,
  onFork,
  forkDisabledReason,
  forkPending,
}: {
  message: ConversationMessage
  onRetry?: () => void
  onOpenAttachment?: (attachment: MessageAttachment) => void
  onFork?: () => void
  forkDisabledReason?: string
  forkPending?: boolean
}) {
  const running = message.status === "streaming"
  const copyText = message.blocks?.length
    ? message.blocks
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n\n")
    : message.text
  const hasProcess = Boolean(
    message.thinking?.text.trim() || message.tools?.length
  )
  return (
    <Message
      align="start"
      aria-label="Agent 回复"
      className="conversation-message"
    >
      <MessageContent className="conversation-assistant-content">
        <div className="conversation-assistant-body">
          {message.blocks?.length ? (
            <>
              {message.thinking?.text && (
                <ThinkingBlock text={message.thinking.text} running={running} />
              )}
              {message.blocks.map((block) => {
                if (block.type === "text") {
                  return <MarkdownContent key={block.id} text={block.text} />
                }
                if (block.type === "tool") {
                  return <ToolCall key={block.id} tool={block.tool} />
                }
                return (
                  <MessageAttachments
                    key={block.id}
                    attachments={block.attachments}
                    onOpenAttachment={onOpenAttachment}
                  />
                )
              })}
            </>
          ) : (
            <>
              <ExecutionProcess
                thinking={message.thinking}
                tools={message.tools}
                running={running}
              />
              {message.text && <MarkdownContent text={message.text} />}
              <MessageAttachments
                attachments={message.attachments ?? []}
                onOpenAttachment={onOpenAttachment}
              />
            </>
          )}
          {running &&
            !message.text &&
            !hasProcess &&
            !message.blocks?.length && (
              <Marker role="status">
                <MarkerContent>
                  <span className="shimmer">正在处理</span>
                </MarkerContent>
              </Marker>
            )}
          {message.status === "interrupted" && (
            <span className="conversation-message-feedback" role="status">
              已停止
            </span>
          )}
          {message.status === "failed" && (
            <span
              className="conversation-message-feedback"
              data-status="failed"
              role="status"
            >
              {onRetry ? "回复未完成，可以重新生成。" : "回复未完成。"}
            </span>
          )}
        </div>
        {(copyText || message.model || message.status === "failed") && (
          <MessageActions
            text={copyText}
            time={message.time}
            model={message.model}
            running={running}
            onRetry={onRetry}
            onFork={onFork}
            forkDisabledReason={forkDisabledReason}
            forkPending={forkPending}
          />
        )}
      </MessageContent>
    </Message>
  )
}
