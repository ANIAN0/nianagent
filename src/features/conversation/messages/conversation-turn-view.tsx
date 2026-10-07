import type { ReactNode } from "react"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { ConversationTurnFeedback } from "../conversation-turn-feedback"
import type {
  ConversationContentBlock,
  ConversationMessage,
  MessageAttachment,
} from "../conversation-types"
import {
  messageBlocks,
  messageText,
  type ProjectedConversationTurn,
} from "../conversation-turns"
import { UserMessage } from "./user-message"
import { MarkdownContent } from "./markdown-content"
import { ThinkingBlock } from "./thinking-block"
import { ToolCall } from "./tool-call"
import { ExecutionProcess } from "./execution-process"
import { MessageAttachments } from "./message-attachments"
import { MessageActions } from "./message-actions"
import type { ConversationStatistics } from "@/features/models/model-contract.generated"
import { useMessageEnvironment } from "./message-environment"

export interface ConversationTurnRecord {
  id: string
  historyIndex: number
  content: ReactNode
}
export function ConversationTurnView({
  turn,
  records = [],
  onFork,
  forkDisabledReason,
  forkPending,
  forkFeedback,
  issueFeedback,
  stopFeedbackProvided = false,
  latest = true,
  statistics,
  showActions = true,
  onRetry,
  onOpenAttachment,
  workspacePath,
}: {
  turn: ProjectedConversationTurn
  records?: readonly ConversationTurnRecord[]
  onFork?: () => void
  forkDisabledReason?: string
  forkPending?: boolean
  forkFeedback?: ReactNode
  issueFeedback?: (
    message: ConversationMessage,
    recovered: boolean
  ) => ReactNode
  /** An authoritative feedback for this exact current run owns its stop reason. */
  stopFeedbackProvided?: boolean
  latest?: boolean
  statistics?: ConversationStatistics
  showActions?: boolean
  onRetry?: () => void
  onOpenAttachment?: (attachment: MessageAttachment) => void
  workspacePath?: string
}) {
  const tail = turn.tail
  const running = tail?.status === "streaming"
  const closed = tail?.stopReason !== "toolUse" && !running
  const process: { id: string; index: number; content: ReactNode }[] = []
  const visibleIssues: { id: string; content: ReactNode }[] = []
  const answer: ConversationContentBlock[] = []
  const tools = turn.messages.flatMap((message) =>
    messageBlocks(message).flatMap((block) =>
      block.type === "tool" ? [block.tool] : []
    )
  )
  for (const message of turn.messages) {
    const blocks = messageBlocks(message).filter(hasVisibleBlock)
    const lastProcess = blocks.findLastIndex(
      (block) => block.type === "thinking" || block.type === "tool"
    )
    const processBlocks = blocks.filter((block, index) => {
      const final =
        !!tail &&
        message === tail &&
        tail.stopReason !== "toolUse" &&
        index > lastProcess
      if (final) answer.push(block)
      return !final
    })
    const issue = issueFeedback?.(
      message,
      turn.recoveredAttemptIds?.has(message.id) ?? false
    )
    // Historical failures belong to this turn and remain readable even while
    // its execution details are collapsed. The authoritative current failure
    // is already deduplicated by the Live view's exact issueEntryId.
    if (issue) visibleIssues.push({ id: message.id, content: issue })
    if (processBlocks.length)
      process.push({
        id: message.id,
        index: message.historyIndex ?? turn.historyIndex,
        content: (
          <div
            className="conversation-process-step"
            data-entry-id={message.entryId}
          >
            {processBlocks.map((block) => (
              <MessageBlock
                key={block.id}
                block={block}
                message={message}
                onOpenAttachment={onOpenAttachment}
              />
            ))}
          </div>
        ),
      })
  }
  const after: ConversationTurnRecord[] = []
  for (const record of records) {
    if (tail && record.historyIndex > (tail.historyIndex ?? turn.historyIndex))
      after.push(record)
    else
      process.push({
        id: record.id,
        index: record.historyIndex,
        content: record.content,
      })
  }
  process.sort((a, b) => a.index - b.index)
  const copyText = tail ? messageText(tail) : ""
  const failures = tools.filter(
    (tool) =>
      tool.status === "failed" ||
      (tool.status === "success" &&
        tool.exitCode !== undefined &&
        tool.exitCode !== 0)
  ).length
  const showStoppedNotice =
    tail?.status === "interrupted" &&
    (!tail.issue || tail.issue.code === "cancelled") &&
    !stopFeedbackProvided
  const hasResponse =
    process.length > 0 ||
    answer.length > 0 ||
    visibleIssues.length > 0 ||
    running ||
    tail?.stopReason === "length" ||
    showStoppedNotice
  return (
    <article
      className="conversation-turn"
      data-turn-id={turn.id}
      data-actions-reveal={latest && answer.length ? "always" : "hover"}
    >
      {turn.user && (
        <UserMessage
          message={turn.user}
          onOpenAttachment={onOpenAttachment}
          workspacePath={workspacePath}
        />
      )}
      {hasResponse && (
        <section className="conversation-turn-response" aria-label="Agent 回复">
          {!!process.length && (
            <ExecutionProcess
              occurrenceId={turn.id}
              running={!closed}
              stopped={showStoppedNotice}
              toolCount={tools.length}
              failureCount={failures}
            >
              <div className="conversation-process-members">
                {process.map((node) => (
                  <div key={node.id} data-process-occurrence={node.id}>
                    {node.content}
                  </div>
                ))}
              </div>
            </ExecutionProcess>
          )}
          {!!answer.length && (
            <div className="conversation-assistant-body">
              {answer.map((block) => (
                <MessageBlock
                  key={block.id}
                  block={block}
                  message={tail!}
                  onOpenAttachment={onOpenAttachment}
                />
              ))}
            </div>
          )}
          {visibleIssues.map((issue) => (
            <div key={issue.id} data-issue-entry={issue.id}>
              {issue.content}
            </div>
          ))}
          {running && !answer.length && !process.length && (
            <Marker role="status">
              <MarkerContent>
                <span className="shimmer">正在处理</span>
              </MarkerContent>
            </Marker>
          )}
          {tail?.stopReason === "length" && (
            <ConversationTurnFeedback
              title="已达到输出 token 上限"
              message="回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。"
              severity="warning"
            />
          )}
          {showStoppedNotice && (
            <span className="conversation-stopped" role="status">
              已停止
            </span>
          )}
          {turn.continued && (
            <p className="conversation-message-feedback">
              已从本轮继续回复，原执行状态保留。
            </p>
          )}
          {showActions && tail && closed && (
            <MessageActions
              text={copyText}
              time={tail.time}
              model={tail.model}
              statistics={statistics}
              onRetry={onRetry}
              onFork={onFork}
              forkDisabledReason={forkDisabledReason}
              forkPending={forkPending}
            />
          )}
          {forkFeedback}
        </section>
      )}
      {after.map((record) => (
        <div key={record.id}>{record.content}</div>
      ))}
    </article>
  )
}

function hasVisibleBlock(block: ConversationContentBlock) {
  if (block.type === "text" || block.type === "thinking")
    return Boolean(block.text.trim())
  if (block.type === "attachments") return block.attachments.length > 0
  return true
}

function MessageBlock({
  block,
  message,
  onOpenAttachment,
}: {
  block: ConversationContentBlock
  message: ConversationMessage
  onOpenAttachment?: (attachment: MessageAttachment) => void
}) {
  const environment = useMessageEnvironment()
  return (
    <div data-block-occurrence={block.id}>
      {block.type === "text" ? (
        <MarkdownContent text={block.text} />
      ) : block.type === "thinking" ? (
        <ThinkingBlock
          occurrenceId={block.id}
          text={block.text}
          running={
            block.phase === "running" ||
            (!block.phase &&
              message.activeBlockId === block.id &&
              message.status === "streaming")
          }
        />
      ) : block.type === "tool" ? (
        <ToolCall
          tool={block.tool}
          occurrenceId={block.id}
          awaitingApproval={environment?.waitingTools?.has(
            JSON.stringify([message.runId, block.tool.id])
          )}
        />
      ) : block.type === "image" ? (
        <MessageAttachments
          attachments={[
            { ...block.image, kind: "image", materialType: "image" },
          ]}
          onOpenAttachment={onOpenAttachment}
        />
      ) : (
        <MessageAttachments
          attachments={block.attachments}
          onOpenAttachment={onOpenAttachment}
        />
      )}
    </div>
  )
}
