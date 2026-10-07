import "./composer.css"
import { useState } from "react"
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
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "@/features/home/composer-panel-context"
import type { ConversationSnapshot } from "@/features/models/model-contract.generated"

export type ContextUsageProps = Partial<
  NonNullable<ConversationSnapshot["context"]>
> &
  Partial<NonNullable<ConversationSnapshot["contextState"]>> & {
    defaultOpen?: boolean
  }

/** The footer and panel share one validity boundary; unknown never becomes zero. */
export function readContextUsage({
  usedTokens,
  contextWindow,
  status,
}: ContextUsageProps) {
  if (
    status ||
    usedTokens === undefined ||
    !Number.isFinite(usedTokens) ||
    usedTokens < 0 ||
    contextWindow === undefined ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  )
    return null
  return {
    usedTokens,
    contextWindow,
    percent: Math.min(100, (usedTokens / contextWindow) * 100),
  }
}

const circumference = 2 * Math.PI * 5.5
const format = (value: number) =>
  value < 1000
    ? String(value)
    : value < 1000000
      ? `${Math.round(value / 100) / 10}K`
      : `${Math.round(value / 100000) / 10}M`
const formatTime = (value?: string) => {
  if (!value) return "尚无记录"
  const time = new Date(value)
  return Number.isNaN(time.getTime())
    ? "尚无记录"
    : new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(time)
}

export function ContextUsage(props: ContextUsageProps) {
  const {
    source,
    estimated,
    observedAt,
    restored,
    status,
    reason,
    defaultOpen,
  } = props
  const [open, setOpen] = useComposerPanel("context", defaultOpen)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const closeAutoFocus = useComposerPanelCloseAutoFocus("context")
  const reading = readContextUsage(props)
  const isEstimate = estimated ?? source === "pi-context-estimate"
  const unknownLabel =
    status === "awaiting-response" ? "上下文待更新" : "上下文未知"
  const percentLabel =
    reading && reading.percent > 0 && reading.percent < 1
      ? "<1%"
      : `${Math.round(reading?.percent ?? 0)}%`
  const label = reading
    ? `上下文已用 ${percentLabel}${restored ? "，历史记录" : ""}`
    : unknownLabel
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setTooltipOpen(false)
        setOpen(nextOpen)
      }}
    >
      <Tooltip
        delayDuration={200}
        open={!open && tooltipOpen}
        onOpenChange={setTooltipOpen}
      >
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="insight"
              size="insight"
              className="context-usage-trigger"
              aria-label={label}
            >
              <svg
                viewBox="0 0 14 14"
                aria-hidden="true"
                className="context-usage-ring"
              >
                <circle className="context-usage-track" cx="7" cy="7" r="5.5" />
                {reading && reading.percent > 0 && (
                  <circle
                    className="context-usage-fill"
                    cx="7"
                    cy="7"
                    r="5.5"
                    strokeDasharray={`${(circumference * reading.percent) / 100} ${circumference}`}
                    transform="rotate(-90 7 7)"
                  />
                )}
              </svg>
              <span>{reading ? percentLabel : unknownLabel}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        onCloseAutoFocus={closeAutoFocus}
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="context-usage-popover"
        aria-label="上下文用量"
      >
        <div className="context-usage-heading">
          <span>{reading ? "上下文已用" : unknownLabel}</span>
          {reading && <strong>{percentLabel}</strong>}
          {reading && (
            <strong
              className="context-usage-figures"
              title={`${reading.usedTokens.toLocaleString("zh-CN")} / ${reading.contextWindow.toLocaleString("zh-CN")} tokens`}
            >
              {isEstimate ? "~" : ""}
              {format(reading.usedTokens)} / {format(reading.contextWindow)}
            </strong>
          )}
        </div>
        {reading && (
          <div
            className="context-usage-bar"
            role="meter"
            aria-label="上下文占用"
            aria-valuenow={reading.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${isEstimate ? "估算 " : ""}${percentLabel}，${reading.usedTokens} / ${reading.contextWindow} tokens`}
          >
            {reading.percent > 0 && (
              <span style={{ width: `${reading.percent}%` }} />
            )}
          </div>
        )}
        <p className="context-usage-note">
          {reading
            ? `${source === "pi-context-estimate" ? "Pi 上下文估算" : "来源未记录"}${restored ? " · 历史记录" : ""}`
            : (reason ?? "尚无可用的上下文用量，完成模型回复后再查看。")}
        </p>
        <dl>
          {!reading &&
            props.contextWindow !== undefined &&
            Number.isFinite(props.contextWindow) &&
            props.contextWindow > 0 && (
              <div>
                <dt>模型容量</dt>
                <dd>{format(props.contextWindow)} tokens</dd>
              </div>
            )}
          <div>
            <dt>观测时间</dt>
            <dd title={observedAt}>{formatTime(observedAt)}</dd>
          </div>
        </dl>
        {reading && (
          <p className="context-usage-note">
            {source === "pi-context-estimate"
              ? "根据模型用量与后续消息估算，不代表精确请求大小或计费。"
              : "未注明统计来源，无法确认测量方式。"}
            {restored && " 已保存的历史读数，下一次模型回复后更新。"}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
