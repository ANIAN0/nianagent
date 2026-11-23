import type { ReactNode } from "react"
import { GitBranch } from "lucide-react"
import "./conversation-layout.css"

export interface ConversationHeaderLineage {
  sourceTitle: string
  onOpenSource?: () => void
}

export interface ConversationHeaderProps {
  title: string
  workspacePath?: string
  lineage?: ConversationHeaderLineage
  leading?: ReactNode
  actions?: ReactNode
  status?: string
}

export function ConversationHeader({
  title,
  workspacePath,
  lineage,
  leading,
  actions,
  status,
}: ConversationHeaderProps) {
  return (
    <header className="conversation-header">
      {leading}
      <div className="conversation-header-label">
        <div className="conversation-header-name">
          <h1 title={title}>{title.trim() || "新会话"}</h1>
          <span role="status" aria-atomic="true">
            {status}
          </span>
        </div>
        {(workspacePath || lineage) && (
          <div className="conversation-header-meta">
            {workspacePath && (
              <span className="conversation-header-path" title={workspacePath}>
                {workspacePath}
              </span>
            )}
            {workspacePath && lineage && (
              <span className="conversation-header-sep" aria-hidden="true">
                ·
              </span>
            )}
            {lineage &&
              (lineage.onOpenSource ? (
                <button
                  type="button"
                  className="conversation-header-lineage"
                  title={`打开来源会话：${lineage.sourceTitle}`}
                  onClick={lineage.onOpenSource}
                >
                  <GitBranch aria-hidden="true" />
                  <span>派生自 {lineage.sourceTitle}</span>
                </button>
              ) : (
                <span
                  className="conversation-header-lineage"
                  title={lineage.sourceTitle}
                >
                  <GitBranch aria-hidden="true" />
                  <span>派生自 {lineage.sourceTitle}</span>
                </span>
              ))}
          </div>
        )}
      </div>
      <div className="conversation-header-actions">{actions}</div>
    </header>
  )
}
