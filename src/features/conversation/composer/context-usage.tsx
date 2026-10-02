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
  onCompact?: () => void
  compactDisabledReason?: string
}
const format = (value: number) =>
  value < 1000 ? String(value) : `${Math.round(value / 100) / 10}K`
export function ContextUsage({
  usedTokens,
  contextWindow,
  breakdown,
  cumulative,
  updatedAt,
  onCompact,
  compactDisabledReason,
}: ContextUsageProps) {
  const known =
    usedTokens !== undefined && contextWindow !== undefined && contextWindow > 0
  const percent = known
    ? Math.max(0, Math.min(100, Math.round((usedTokens / contextWindow) * 100)))
    : undefined
  const parts = breakdown
    ? [
        { label: "系统提示词", value: breakdown.systemTokens, key: "system" },
        { label: "工具定义", value: breakdown.toolsTokens, key: "tools" },
        { label: "对话消息", value: breakdown.messageTokens, key: "messages" },
      ]
    : []
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="context-usage-trigger"
          aria-label={known ? `上下文已用 ${percent}%` : "上下文未知"}
        >
          <CircleGauge data-icon="inline-start" />
          {known ? `${percent}%` : "上下文未知"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        className="context-usage-popover"
        aria-label="上下文与用量"
      >
        <div className="context-usage-heading">
          <span>上下文已用</span>
          <strong>{known ? `${percent}%` : "未知"}</strong>
          <Badge variant="secondary">估算</Badge>
          {known && (
            <strong>
              ~{format(usedTokens)} / {format(contextWindow)}
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
              <dd>~{format(part.value)}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <dl>
          <div>
            <dt>数据范围</dt>
            <dd>完整请求（模拟）</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>{updatedAt ?? "尚无记录"}</dd>
          </div>
        </dl>
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
        <p className="context-usage-note">累计用量不等于当前上下文占用。</p>
        {onCompact && (
          <>
            <Separator />
            <Button
              variant="outline"
              size="sm"
              disabled={!!compactDisabledReason}
              onClick={onCompact}
            >
              压缩上下文
            </Button>
            {compactDisabledReason && (
              <p className="context-usage-note">{compactDisabledReason}</p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
