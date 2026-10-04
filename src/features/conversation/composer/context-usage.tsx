import "./composer.css"
import { CircleGauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "@/features/home/composer-panel-context"
export type ContextUsageProps = {
  usedTokens?: number
  contextWindow?: number
  breakdown?: {
    systemTokens: number
    toolsTokens: number
    messageTokens: number
  }
  cumulative?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
  }
  updatedAt?: string
  source?: "pi-context-estimate"
  estimated?: boolean
  observedAt?: string
  restored?: boolean
  status?: "awaiting-response" | "unavailable"
  reason?: string
  defaultOpen?: boolean
  onCompact?: () => void
  compactActive?: boolean
  compactDisabledReason?: string
}
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
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(time)
}
export function ContextUsage({
  usedTokens,
  contextWindow,
  breakdown,
  cumulative,
  updatedAt,
  source,
  estimated,
  observedAt,
  restored,
  status,
  reason,
  defaultOpen,
  onCompact,
  compactActive,
  compactDisabledReason,
}: ContextUsageProps) {
  const [open, setOpen] = useComposerPanel("context", defaultOpen)
  const closeAutoFocus = useComposerPanelCloseAutoFocus("context")
  const known =
    usedTokens !== undefined &&
    Number.isFinite(usedTokens) &&
    usedTokens >= 0 &&
    contextWindow !== undefined &&
    Number.isFinite(contextWindow) &&
    contextWindow > 0
  const isEstimate = estimated ?? source === "pi-context-estimate"
  const unknownLabel =
    status === "awaiting-response" ? "上下文待更新" : "上下文未知"
  const percent = known
    ? Math.max(0, Math.min(100, (usedTokens / contextWindow) * 100))
    : undefined
  const percentLabel =
    percent !== undefined && percent > 0 && percent < 1
      ? "<1%"
      : `${Math.round(percent ?? 0)}%`
  const parts = breakdown
    ? [
        { label: "系统提示词", value: breakdown.systemTokens, key: "system" },
        { label: "工具定义", value: breakdown.toolsTokens, key: "tools" },
        { label: "对话消息", value: breakdown.messageTokens, key: "messages" },
      ]
    : []
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="context-usage-trigger"
          aria-label={
            known
              ? `上下文已用 ${percentLabel}${restored ? "，历史记录" : ""}`
              : unknownLabel
          }
        >
          <CircleGauge data-icon="inline-start" />
          {known ? percentLabel : unknownLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        onCloseAutoFocus={closeAutoFocus}
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        className="context-usage-popover"
        aria-label="上下文与用量"
      >
        <div className="context-usage-heading">
          <span>上下文已用</span>
          <strong>{known ? percentLabel : "未知"}</strong>
          {known && isEstimate && <Badge variant="secondary">估算</Badge>}
          {known && (
            <strong>
              {isEstimate ? "~" : ""}
              {format(usedTokens)} / {format(contextWindow)}
            </strong>
          )}
        </div>
        {known && (
          <div
            className="context-usage-bar"
            role="meter"
            aria-label="上下文占用"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {parts.length ? (
              parts.map((part) => (
                <span
                  key={part.key}
                  data-part={part.key}
                  style={{ width: `${(part.value / contextWindow) * 100}%` }}
                />
              ))
            ) : (
              <span data-part="messages" style={{ width: `${percent}%` }} />
            )}
          </div>
        )}
        <dl>
          {parts.map((part) => (
            <div key={part.key}>
              <dt>
                <i data-part={part.key} />
                {part.label}
              </dt>
              <dd>
                {isEstimate ? "~" : ""}
                {format(part.value)}
              </dd>
            </div>
          ))}
        </dl>
        <Separator />
        <dl>
          <div>
            <dt>数据来源</dt>
            <dd>
              {source === "pi-context-estimate" ? "Pi 上下文估算" : "未记录"}
            </dd>
          </div>
          {contextWindow !== undefined && (
            <div>
              <dt>模型容量</dt>
              <dd>{format(contextWindow)} tokens</dd>
            </div>
          )}
          <div>
            <dt>统计状态</dt>
            <dd>
              {!known ? unknownLabel : restored ? "从历史恢复" : "已记录占用"}
            </dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd title={observedAt ?? updatedAt}>
              {formatTime(observedAt ?? updatedAt)}
            </dd>
          </div>
        </dl>
        <p className="context-usage-note">
          {!known
            ? (reason ?? "尚无可用的上下文用量，完成模型回复后再查看。")
            : source === "pi-context-estimate"
              ? "Pi 根据模型返回的用量及后续消息估算当前上下文，不代表精确请求大小或计费。"
              : "此记录未注明统计来源，不能确认测量方式。"}
        </p>
        {restored && known && (
          <p className="context-usage-note">
            显示已保存的历史统计，下一次模型回复后更新。
          </p>
        )}
        {cumulative && (
          <>
            <Separator />
            <p>累计用量 · 本会话</p>
            <dl>
              <div>
                <dt>输入</dt>
                <dd>{format(cumulative.inputTokens)}</dd>
              </div>
              <div>
                <dt>输出</dt>
                <dd>{format(cumulative.outputTokens)}</dd>
              </div>
              <div>
                <dt>缓存读取</dt>
                <dd>{format(cumulative.cacheReadTokens)}</dd>
              </div>
            </dl>
          </>
        )}
        {cumulative && (
          <p className="context-usage-note">累计用量不等于当前上下文占用。</p>
        )}
        {onCompact && (
          <>
            <Separator />
            <Button
              variant="outline"
              size="sm"
              disabled={!compactActive && !!compactDisabledReason}
              onClick={onCompact}
            >
              {compactActive ? "查看压缩状态" : "压缩上下文"}
            </Button>
            {!compactActive && compactDisabledReason && (
              <p className="context-usage-note">{compactDisabledReason}</p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
