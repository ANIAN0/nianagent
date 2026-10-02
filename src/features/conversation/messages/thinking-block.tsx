import { useState } from "react"
import { Brain, ChevronDown } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { MarkdownContent } from "./markdown-content"
import "./messages.css"

export function ThinkingBlock({
  text,
  running = false,
  defaultOpen = false,
}: {
  text: string
  running?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const lines = text.split("\n").filter((line) => line.trim())
  const summary = (running ? lines.at(-1) : lines[0])?.replaceAll("**", "")
  if (!text.trim()) return null
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="conversation-thinking"
    >
      <CollapsibleTrigger
        className="conversation-process-trigger"
        aria-label={open ? "收起思考" : "展开思考"}
      >
        <Brain aria-hidden />
        <strong>思考</strong>
        {!open && (
          <>
            <span aria-hidden>·</span>
            <span
              className={
                running
                  ? "conversation-process-summary shimmer"
                  : "conversation-process-summary"
              }
            >
              {summary}
            </span>
          </>
        )}
        <ChevronDown className="conversation-disclosure-chevron" aria-hidden />
      </CollapsibleTrigger>
      {running && (
        <span className="sr-only" role="status">
          正在思考
        </span>
      )}
      <CollapsibleContent>
        <div className="conversation-thinking-body">
          <MarkdownContent text={text} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
