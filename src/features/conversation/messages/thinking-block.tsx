import { Brain } from "lucide-react"
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
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
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger aria-label={open ? "收起思考" : "展开思考"}>
        <TraceLine status={running ? "running" : undefined}>
          <TraceIcon>
            <Brain />
          </TraceIcon>
          <TraceTitle>
            {open || !summary ? "思考" : `思考 · ${summary}`}
          </TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      {running && (
        <span className="sr-only" role="status">
          正在思考
        </span>
      )}
      <TraceCollapsibleContent>
        <div className="conversation-thinking-body">
          <MarkdownContent text={text} />
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}
