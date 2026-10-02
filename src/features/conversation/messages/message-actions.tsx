import { Info, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CopyButton } from "./copy-button"
import "./messages.css"

export function MessageActions({
  text,
  time,
  model,
  align = "start",
  running = false,
  onRetry,
}: {
  text: string
  time?: string | number
  model?: string
  align?: "start" | "end"
  running?: boolean
  onRetry?: () => void
}) {
  const date = time === undefined ? undefined : new Date(time)
  const clock =
    date && !Number.isNaN(date.getTime()) ? (
      <time dateTime={date.toISOString()} title={date.toLocaleString("zh-CN")}>
        {date.toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </time>
    ) : null
  return (
    <div className="conversation-message-actions" data-align={align}>
      {align === "end" && clock}
      {text.trim() && (
        <CopyButton text={text} label={running ? "复制当前内容" : "复制消息"} />
      )}
      {model && (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="消息信息"
                >
                  <Info />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>消息信息</TooltipContent>
          </Tooltip>
          <PopoverContent
            align={align === "end" ? "end" : "start"}
            className="conversation-message-info"
          >
            <h3>消息信息</h3>
            <dl>
              <dt>角色</dt>
              <dd>{align === "end" ? "用户" : "Agent"}</dd>
              {clock && (
                <>
                  <dt>时间</dt>
                  <dd>{date!.toLocaleString("zh-CN")}</dd>
                </>
              )}
              {model && (
                <>
                  <dt>模型</dt>
                  <dd>{model}</dd>
                </>
              )}
              <dt>状态</dt>
              <dd>{running ? "正在输出" : "已记录"}</dd>
            </dl>
          </PopoverContent>
        </Popover>
      )}
      {onRetry && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="重新生成回复"
              disabled={running}
              onClick={onRetry}
            >
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {running ? "输出完成后可重试" : "重新生成回复"}
          </TooltipContent>
        </Tooltip>
      )}
      {align === "start" && clock}
    </div>
  )
}
