import { ChevronDown } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { ConversationMessage } from "../conversation-types"
import { ThinkingBlock } from "./thinking-block"
import { ToolCall } from "./tool-call"
import "./messages.css"
import type { ReactNode } from "react"
import { useMessageDisclosure } from "./message-environment"

export function ExecutionProcess({
  thinking,
  tools = [],
  running = false,
  defaultOpen = false,
  children,
  toolCount,
  failureCount,
  occurrenceId,
}: {
  thinking?: ConversationMessage["thinking"]
  tools?: ConversationMessage["tools"]
  running?: boolean
  defaultOpen?: boolean
  children?: ReactNode
  toolCount?: number
  failureCount?: number
  occurrenceId?: string
}) {
  const [open, setOpen] = useMessageDisclosure(
    occurrenceId,
    "process",
    defaultOpen
  )
  if (!children && !thinking?.text.trim() && !tools.length) return null
  const count = toolCount ?? tools.length
  const failures =
    failureCount ??
    tools.filter(
      (tool) =>
        tool.status === "failed" ||
        (tool.status === "success" &&
          tool.exitCode !== undefined &&
          tool.exitCode !== 0)
    ).length
  const content = children ?? (
    <div className="conversation-process-members">
      {thinking?.text && (
        <ThinkingBlock
          text={thinking.text}
          running={running && !tools.length}
        />
      )}
      {tools.map((tool) => (
        <ToolCall key={tool.id} tool={tool} />
      ))}
    </div>
  )
  if (running) return content
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="conversation-execution"
    >
      <CollapsibleTrigger className="conversation-execution-summary">
        {count
          ? `${count} 次工具调用`
          : thinking?.duration
            ? `已思考 ${thinking.duration}`
            : "执行过程"}
        {failures > 0 && (
          <span className="conversation-execution-failures">
            {failures} 次失败
          </span>
        )}
        <ChevronDown className="conversation-disclosure-chevron" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>{content}</CollapsibleContent>
    </Collapsible>
  )
}
