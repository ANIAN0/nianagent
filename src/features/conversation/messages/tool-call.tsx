import { useState } from "react"
import { ChevronDown, Wrench } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { ConversationToolCall } from "../conversation-types"
import "./messages.css"

const labels = {
  running: "执行中",
  success: "成功",
  failed: "失败",
  stopped: "已停止",
  "not-run": "未执行",
}

export function ToolCall({
  tool,
  defaultOpen = false,
}: {
  tool: ConversationToolCall
  defaultOpen?: boolean
}) {
  const [full, setFull] = useState(false)
  const lines = tool.result?.split("\n") ?? []
  const status =
    tool.status === "success" &&
    tool.exitCode !== undefined &&
    tool.exitCode !== 0
      ? "failed"
      : tool.status
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="conversation-tool"
      data-status={status}
    >
      <CollapsibleTrigger
        className="conversation-process-trigger"
        aria-label={`工具调用 ${tool.name}`}
      >
        <Wrench aria-hidden />
        <strong className="conversation-tool-name" title={tool.name}>
          {tool.name}
        </strong>
        <span aria-hidden>·</span>
        <span className="conversation-tool-source" title={tool.source}>
          {tool.source}
        </span>
        <span className="conversation-tool-status">
          <span aria-hidden />
          {labels[status]}
        </span>
        <ChevronDown className="conversation-disclosure-chevron" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="conversation-tool-detail">
          <Collapsible>
            <CollapsibleTrigger className="conversation-detail-trigger">
              <ChevronDown className="conversation-disclosure-chevron" />
              输入{tool.input === undefined && <span>未记录</span>}
            </CollapsibleTrigger>
            <CollapsibleContent className="conversation-detail-content">
              <pre>{tool.input ?? "此记录未提供输入参数。"}</pre>
            </CollapsibleContent>
          </Collapsible>
          <Separator />
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="conversation-detail-trigger">
              <ChevronDown className="conversation-disclosure-chevron" />
              结果{lines.length > 20 && <span>{lines.length} 行</span>}
            </CollapsibleTrigger>
            <CollapsibleContent className="conversation-detail-content">
              <div className="conversation-tool-output">
                {tool.result
                  ? full
                    ? tool.result
                    : lines.slice(0, 20).join("\n")
                  : status === "running"
                    ? "尚未收到结果"
                    : status === "not-run"
                      ? "此调用未执行"
                      : status === "stopped"
                        ? "执行已停止，未返回结果"
                        : "此记录未保存结果内容"}
              </div>
              {lines.length > 20 && (
                <Button
                  variant="link"
                  size="xs"
                  aria-expanded={full}
                  onClick={() => setFull(!full)}
                >
                  {full
                    ? "收起已保存内容"
                    : `展开已保存内容（${lines.length} 行）`}
                </Button>
              )}
              {tool.exitCode !== undefined && (
                <p className="conversation-tool-exit">
                  退出码：{tool.exitCode}
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
