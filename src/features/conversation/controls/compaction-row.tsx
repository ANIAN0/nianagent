import { useState, type ReactNode } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import "./compaction-row.css"

/** The command and its saved checkpoint share the same compact disclosure. */
export function CompactionRow({
  title,
  summary,
  running = false,
  error = false,
  children,
}: {
  title: string
  summary: string
  running?: boolean
  error?: boolean
  children?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const expandable = !!children
  const open = expandable && expanded
  return (
    <Collapsible
      open={open}
      onOpenChange={setExpanded}
      className="conversation-compaction-row"
      data-running={running || undefined}
      data-error={error || undefined}
    >
      <CollapsibleTrigger asChild disabled={!expandable}>
        <Marker asChild className="conversation-compaction-trigger">
          <button
            type="button"
            aria-label={`${title} · ${summary}`}
            aria-expanded={expandable ? open : undefined}
          >
            <MarkerIcon className="conversation-compaction-leading">
              <svg
                className="conversation-compaction-context-icon"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                aria-hidden
              >
                <path d="M3 4L7 8L3 12" />
                <path d="M9 12H13" />
              </svg>
              <svg
                className="conversation-compaction-disclosure-icon"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                aria-hidden
              >
                <path
                  d={
                    open
                      ? "M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6"
                      : "M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4"
                  }
                />
              </svg>
            </MarkerIcon>
            <span className="conversation-compaction-title">{title}</span>
            <span className="conversation-compaction-separator" aria-hidden />
            <MarkerContent
              className={`conversation-compaction-summary${running ? " shimmer" : ""}`}
            >
              {summary}
            </MarkerContent>
          </button>
        </Marker>
      </CollapsibleTrigger>
      {running && <span className="sr-only" role="status">正在压缩…</span>}
      {expandable && (
        <CollapsibleContent className="conversation-compaction-body">
          {children}
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}
