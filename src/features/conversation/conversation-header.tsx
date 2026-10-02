import type { ReactNode } from "react"
import "./conversation-layout.css"

export interface ConversationHeaderProps {
  title: string
  workspacePath?: string
  leading?: ReactNode
  actions?: ReactNode
  status?: string
}

export function ConversationHeader({
  title,
  workspacePath,
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
        {workspacePath && <span title={workspacePath}>{workspacePath}</span>}
      </div>
      {actions && <div className="conversation-header-actions">{actions}</div>}
    </header>
  )
}
