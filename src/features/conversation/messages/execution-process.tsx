import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import type { ReactNode } from "react"
import type { ConversationMessage } from "../conversation-types"
import { ThinkingBlock } from "./thinking-block"
import { ToolCall } from "./tool-call"
import { useMessageDisclosure } from "./message-environment"

export function ExecutionProcess({
  thinking,
  tools = [],
  running = false,
  stopped = false,
  defaultOpen = false,
  children,
  toolCount,
  failureCount,
  occurrenceId,
}: {
  thinking?: ConversationMessage["thinking"]
  tools?: ConversationMessage["tools"]
  running?: boolean
  stopped?: boolean
  defaultOpen?: boolean
  children?: ReactNode
  toolCount?: number
  failureCount?: number
  occurrenceId?: string
}) {
  const [open, setOpen] = useMessageDisclosure(
    occurrenceId,
    "process",
    defaultOpen || running
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
  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : undefined}>
            <TraceTitle>
              {stopped ? "已停止" : running ? "执行中" : "执行过程"}
            </TraceTitle>
            {count > 0 && (
              <TraceDescription>{count} 次工具调用</TraceDescription>
            )}
            {failures > 0 && (
              <TraceDescription className="text-destructive">
                {failures} 次失败
              </TraceDescription>
            )}
            {thinking?.duration && !count && (
              <TraceDescription>{thinking.duration}</TraceDescription>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>{content}</TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
