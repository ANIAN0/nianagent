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

export function ExecutionProcess({
  thinking,
  tools = [],
  running = false,
  defaultOpen = false,
}: {
  thinking?: ConversationMessage["thinking"]
  tools?: ConversationMessage["tools"]
  running?: boolean
  defaultOpen?: boolean
}) {
  if (!thinking?.text.trim() && !tools.length) return null
  const failures = tools.filter(
    (tool) =>
      tool.status === "failed" ||
      (tool.status === "success" &&
        tool.exitCode !== undefined &&
        tool.exitCode !== 0)
  ).length
  const content = (
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
    <Collapsible defaultOpen={defaultOpen} className="conversation-execution">
      <CollapsibleTrigger className="conversation-execution-summary">
        {tools.length
          ? `${tools.length} 次工具调用`
          : thinking?.duration
            ? `已思考 ${thinking.duration}`
            : "已思考"}
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
