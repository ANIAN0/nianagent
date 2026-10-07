import { useState, type ReactNode, type Ref } from "react"
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty"
import { ConversationHeader } from "./conversation-header"
import {
  ConversationList,
  type ConversationListItem,
  type ConversationReadingPosition,
} from "./conversation-list"
import "./conversation-layout.css"
import { ConversationReadFeedback } from "./conversation-read-feedback"
import type { FeedbackDescription } from "@/lib/operation-issue"

export interface ConversationPageProps {
  rootRef?: Ref<HTMLElement>
  viewKey: string
  title: string
  workspacePath?: string
  status?: string
  state?: "ready" | "loading" | "error"
  error?: string
  issue?: FeedbackDescription
  notice?: ReactNode
  connectionMessage?: string
  onRetry?: () => void
  retrying?: boolean
  onOpenSettings?: () => void
  headerLeading?: ReactNode
  headerActions?: ReactNode
  items: readonly ConversationListItem[]
  composer: ReactNode
  /** Retain the draft and original recovery controls even before history is readable. */
  keepComposer?: boolean
  question?: ReactNode
  readingPositions?: Map<string, ConversationReadingPosition>
  onReadingPositionChange?: (
    viewKey: string,
    position: ConversationReadingPosition
  ) => void
}

export function ConversationPage({
  rootRef,
  viewKey,
  title,
  workspacePath,
  status,
  state = "ready",
  error,
  issue,
  notice,
  connectionMessage,
  onRetry,
  retrying = false,
  onOpenSettings,
  headerLeading,
  headerActions,
  items,
  composer,
  keepComposer = false,
  question,
  onReadingPositionChange,
  readingPositions,
}: ConversationPageProps) {
  const [localPositions] = useState(
    () => new Map<string, ConversationReadingPosition>()
  )
  const positions = readingPositions ?? localPositions
  const readFailure =
    issue ??
    (state === "error"
      ? {
          code: "conversation_read_failed",
          message: error ?? "会话暂时无法读取，草稿已保留。",
          recovery: "reload" as const,
        }
      : undefined)
  const empty = state === "ready" && items.length === 0 && !readFailure
  const readFeedback = readFailure ? (
    <ConversationReadFeedback
      issue={readFailure}
      hasHistory={items.length > 0}
      retrying={retrying}
      onRetry={onRetry}
      onOpenSettings={onOpenSettings}
    />
  ) : null
  return (
    <section
      ref={rootRef}
      className="conversation-page"
      aria-label="会话视图"
      data-conversation-session={viewKey}
    >
      <ConversationHeader
        title={title}
        workspacePath={workspacePath}
        status={status}
        leading={headerLeading}
        actions={headerActions}
      />
      {connectionMessage && (
        <p className="conversation-connection" role="status">
          {connectionMessage}
        </p>
      )}
      {notice && <div className="px-4 pb-2">{notice}</div>}
      <div className="conversation-body" data-empty={empty || undefined}>
        {items.length > 0 && readFeedback}
        {!empty && (
          <div
            className="conversation-reading"
            data-conversation-region="history"
            aria-busy={state === "loading" || undefined}
          >
            {readFailure && items.length === 0 ? (
              readFeedback
            ) : state === "ready" || items.length > 0 ? (
              <ConversationList
                key={viewKey}
                items={items}
                initialPosition={positions.get(viewKey)}
                onPositionChange={(position) => {
                  positions.set(viewKey, position)
                  onReadingPositionChange?.(viewKey, position)
                }}
              />
            ) : (
              <Empty role="status">
                <EmptyHeader>
                  <EmptyDescription>正在读取会话…</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        )}
        {(state === "ready" || keepComposer) && (
          <div
            className="conversation-input-seat"
            data-conversation-region="composer"
            data-question={Boolean(question) || undefined}
          >
            <div className="conversation-input-inner">
              {question}
              <div hidden={Boolean(question)}>{composer}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
