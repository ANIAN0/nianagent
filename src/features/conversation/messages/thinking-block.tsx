import { Brain, ChevronDown } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { MarkdownContent } from "./markdown-content"
import { useMessageDisclosure } from "./message-environment"
import { thinkingSummary } from "./thinking-summary"
import "./messages.css"

export function ThinkingBlock({
  text,
  running = false,
  defaultOpen = false,
  occurrenceId,
}: {
  text: string
  running?: boolean
  defaultOpen?: boolean
  occurrenceId?: string
}) {
  const [open, setOpen] = useMessageDisclosure(
    occurrenceId,
    "thinking",
    defaultOpen
  )
  const summary = thinkingSummary(text, running)
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
