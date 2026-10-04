import { useState, type ReactNode } from "react"
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty"
import { ConversationHeader } from "./conversation-header"
import {
  ConversationList,
  type ConversationListItem,
  type ConversationReadingPosition,
} from "./conversation-list"
import "./conversation-layout.css"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { FeedbackDescription } from "@/lib/operation-issue"

export interface ConversationPageProps {
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
  const empty = state === "ready" && items.length === 0
  return (
    <section className="conversation-page" aria-label="会话视图">
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
        {!empty && (
          <div
            className="conversation-reading"
            aria-busy={state === "loading" || undefined}
          >
            {state === "ready" ? (
              <ConversationList
                key={viewKey}
                items={items}
                initialPosition={positions.get(viewKey)}
                onPositionChange={(position) => {
                  positions.set(viewKey, position)
                  onReadingPositionChange?.(viewKey, position)
                }}
              />
            ) : state === "error" ? (
              <div className="mx-auto w-full max-w-3xl px-4 py-8">
                <OperationFeedback
                  title="会话无法读取"
                  message={
                    issue?.message ?? error ?? "会话暂时无法读取，草稿已保留。"
                  }
                  details={issue?.details}
                  actions={
                    <RecoveryAction
                      issue={
                        issue ?? {
                          code: "conversation_read_failed",
                          message: error ?? "会话暂时无法读取。",
                          recovery: "reload",
                        }
                      }
                      onRetry={onRetry}
                      onReload={onRetry}
                      onCheck={onRetry}
                      onSettings={onOpenSettings}
                      labels={{
                        retry: "重新读取会话",
                        reload: "重新读取会话",
                        check: "核对会话状态",
                        settings: "检查模型设置",
                      }}
                    />
                  }
                />
              </div>
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
