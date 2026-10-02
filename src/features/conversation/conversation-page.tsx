import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty"
import { ConversationHeader } from "./conversation-header"
import {
  ConversationList,
  type ConversationListItem,
  type ConversationReadingPosition,
} from "./conversation-list"
import "./conversation-layout.css"

export interface ConversationPageProps {
  viewKey: string
  title: string
  workspacePath?: string
  status?: string
  state?: "ready" | "loading" | "error"
  error?: string
  connectionMessage?: string
  onRetry?: () => void
  headerLeading?: ReactNode
  headerActions?: ReactNode
  items: readonly ConversationListItem[]
  composer: ReactNode
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
  connectionMessage,
  onRetry,
  headerLeading,
  headerActions,
  items,
  composer,
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
            ) : (
              <Empty role={state === "error" ? "alert" : "status"}>
                <EmptyHeader>
                  <EmptyDescription>
                    {state === "loading"
                      ? "正在读取会话…"
                      : error || "会话读取失败，草稿已保留。"}
                  </EmptyDescription>
                </EmptyHeader>
                {state === "error" && onRetry && (
                  <Button variant="outline" size="sm" onClick={onRetry}>
                    重新读取
                  </Button>
                )}
              </Empty>
            )}
          </div>
        )}
        {state === "ready" && (
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
