import { Database, RotateCcw } from "lucide-react"
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
import { ForkAction } from "../controls/fork-action"
import type { ConversationStatistics } from "@/contracts/rpc.generated"
import "./messages.css"

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}

function formatExactTokens(value: number): string {
  return value.toLocaleString("en-US")
}

export function MessageActions({
  text,
  time,
  model,
  align = "start",
  running = false,
  statistics,
  onRetry,
  onFork,
  forkDisabledReason,
  forkPending,
}: {
  text: string
  time?: string | number
  model?: string
  align?: "start" | "end"
  running?: boolean
  statistics?: ConversationStatistics
  onRetry?: () => void
  onFork?: () => void
  forkDisabledReason?: string
  forkPending?: boolean
}) {
  const date = time === undefined ? undefined : new Date(time)
  const today = new Date()
  const sameDay = date?.toDateString() === today.toDateString()
  const clock =
    date && !Number.isNaN(date.getTime()) ? (
      <time dateTime={date.toISOString()} title={date.toLocaleString("zh-CN")}>
        {!sameDay &&
          `${date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" as const } : {}) })} `}
        {date.toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </time>
    ) : null
  return (
    <div className="conversation-message-actions" data-align={align}>
      {text.trim() && (
        <CopyButton text={text} label={running ? "复制当前内容" : "复制消息"} />
      )}
      {statistics && (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="本轮用量"
                  className="conversation-usage-pill"
                >
                  <Database className="size-4" />
                  <span>
                    用量 {formatCompactTokens(statistics.totalTokens)} token
                  </span>
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>本轮用量</TooltipContent>
          </Tooltip>
          <PopoverContent
            align={align === "end" ? "end" : "start"}
            className="conversation-message-info"
          >
            <div className="conversation-message-info-title">
              <h3>本轮用量</h3>
              <span>{formatExactTokens(statistics.totalTokens)}</span>
            </div>
            <div className="conversation-message-info-rule" />
            <dl>
              {model && (
                <>
                  <dt>模型</dt>
                  <dd>{model}</dd>
                </>
              )}
              {statistics.totalTokens > statistics.output && (
                <>
                  <dt>缓存命中</dt>
                  <dd>
                    {(
                      (statistics.cacheRead /
                        (statistics.totalTokens - statistics.output)) *
                      100
                    ).toFixed(1)}
                    %
                  </dd>
                </>
              )}
              <dt>未缓存输入</dt>
              <dd>{formatExactTokens(statistics.input)} token</dd>
              <dt>缓存读取</dt>
              <dd>{formatExactTokens(statistics.cacheRead)} token</dd>
              <dt>缓存写入</dt>
              <dd>{formatExactTokens(statistics.cacheWrite)} token</dd>
              <dt>输出</dt>
              <dd>{formatExactTokens(statistics.output)} token</dd>
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
              <RotateCcw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {running ? "输出完成后可重试" : "重新生成回复"}
          </TooltipContent>
        </Tooltip>
      )}
      {onFork && (
        <ForkAction
          pending={forkPending}
          disabledReason={
            running ? "回复正在输出，请等待完成。" : forkDisabledReason
          }
          onFork={onFork}
        />
      )}
      {clock}
    </div>
  )
}
