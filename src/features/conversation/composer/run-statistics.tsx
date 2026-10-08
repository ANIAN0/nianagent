import { Database, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import type { ConversationStatistics } from "@/contracts/rpc.generated"
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "@/components/composer/composer-panel-context"
import "./composer.css"

const valid = (value?: number): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0
const format = (count: number) => count.toLocaleString("zh-CN")
const compactTokens = (count: number) => {
  const scaled = (value: number) =>
    String(value >= 100 ? Math.round(value) : Math.round(value * 10) / 10)
  return count < 1000
    ? String(count)
    : count < 1000000
      ? `${scaled(count / 1000)}K`
      : `${scaled(count / 1000000)}M`
}
const formatCacheHit = (cacheRead: number, promptTokens: number) => {
  if (cacheRead === promptTokens) return "100"
  const percent = (cacheRead / promptTokens) * 100
  for (let digits = 0; digits <= 12; digits++) {
    const rounded = Number(percent.toFixed(digits))
    if (rounded < 100) return String(rounded)
  }
  return "<100"
}

export function readRunStatistics(value: ConversationStatistics) {
  const showUsage =
    [
      value.input,
      value.output,
      value.cacheRead,
      value.cacheWrite,
      value.totalTokens,
    ].every(valid) && value.totalTokens > 0
  const promptTokens = value.input + value.cacheRead + value.cacheWrite
  const cacheHit =
    showUsage && Number.isFinite(promptTokens) && promptTokens > 0
      ? formatCacheHit(value.cacheRead, promptTokens)
      : null
  const showPerformance = [
    value.steps,
    value.toolCalls,
    value.durationMs,
    value.modelDurationMs,
    value.tokensPerSecond,
  ].some((count) => valid(count) && count > 0)
  return { showUsage, showPerformance, cacheHit }
}

function StatSeparator() {
  return (
    <span className="composer-insight-separator" aria-hidden="true">
      ·
    </span>
  )
}

function PerformanceStatistics({ value }: { value: ConversationStatistics }) {
  const [open, setOpen] = useComposerPanel("statistics")
  const closeAutoFocus = useComposerPanelCloseAutoFocus("statistics")
  const counts =
    valid(value.turns) && valid(value.steps)
      ? `${format(value.turns)} 轮 ${format(value.steps)} 步`
      : "运行统计"
  const speed = valid(value.tokensPerSecond)
    ? `${value.tokensPerSecond >= 10 ? Math.round(value.tokensPerSecond) : Math.round(value.tokensPerSecond * 10) / 10} token/s`
    : null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="insight" size="insight" aria-label="运行统计">
          <Gauge data-icon="inline-start" />
          <span className="composer-insight-label">
            {counts}
            {speed !== null && (
              <>
                <StatSeparator />
                {speed}
              </>
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="composer-insight-popover"
        align="center"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        onCloseAutoFocus={closeAutoFocus}
        aria-label="运行统计详情"
      >
        <div className="context-usage-heading">
          <Gauge />
          <strong>运行统计{value.restored && " · 历史恢复"}</strong>
        </div>
        <Separator />
        <dl>
          {valid(value.turns) && (
            <div>
              <dt>会话轮数</dt>
              <dd>{format(value.turns)}</dd>
            </div>
          )}
          {valid(value.steps) && (
            <div>
              <dt>模型回复步数</dt>
              <dd>{format(value.steps)}</dd>
            </div>
          )}
          {valid(value.toolCalls) && (
            <div>
              <dt>工具调用</dt>
              <dd>{format(value.toolCalls)}</dd>
            </div>
          )}
          {valid(value.durationMs) && (
            <div>
              <dt>本轮总耗时</dt>
              <dd>{(value.durationMs / 1000).toFixed(1)} 秒</dd>
            </div>
          )}
          {valid(value.modelDurationMs) && (
            <div>
              <dt>本轮模型生成耗时</dt>
              <dd>{(value.modelDurationMs / 1000).toFixed(1)} 秒</dd>
            </div>
          )}
          {valid(value.tokensPerSecond) && (
            <div>
              <dt>本轮生成速度（估算）</dt>
              <dd>{value.tokensPerSecond.toFixed(1)} token/s</dd>
            </div>
          )}
        </dl>
      </PopoverContent>
    </Popover>
  )
}

function TokenStatistics({
  value,
  cacheHit,
}: {
  value: ConversationStatistics
  cacheHit: string | null
}) {
  const [open, setOpen] = useComposerPanel("usage")
  const closeAutoFocus = useComposerPanelCloseAutoFocus("usage")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="insight" size="insight" aria-label="会话累计用量">
          <Database data-icon="inline-start" />
          <span className="composer-insight-label">
            {compactTokens(value.totalTokens)} token
            {cacheHit !== null && (
              <>
                <StatSeparator />
                缓存命中 {cacheHit}%
              </>
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="composer-insight-popover"
        align="center"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        onCloseAutoFocus={closeAutoFocus}
        aria-label="会话累计用量详情"
      >
        <div className="context-usage-heading">
          <Database />
          <strong>累计用量{value.restored && " · 历史恢复"}</strong>
          <strong className="context-usage-figures">
            {compactTokens(value.totalTokens)} token
          </strong>
        </div>
        <Separator />
        <dl>
          <div>
            <dt>总用量</dt>
            <dd>{format(value.totalTokens)} token</dd>
          </div>
          {cacheHit !== null && (
            <div>
              <dt>缓存命中</dt>
              <dd>{cacheHit}%</dd>
            </div>
          )}
          <div>
            <dt>非缓存输入</dt>
            <dd>{format(value.input)} token</dd>
          </div>
          <div>
            <dt>缓存读取</dt>
            <dd>{format(value.cacheRead)} token</dd>
          </div>
          {value.cacheWrite > 0 && (
            <div>
              <dt>缓存写入</dt>
              <dd>{format(value.cacheWrite)} token</dd>
            </div>
          )}
          <div>
            <dt>输出</dt>
            <dd>{format(value.output)} token</dd>
          </div>
          <div>
            <dt>费用估算</dt>
            <dd>
              {valid(value.cost) ? `$${value.cost.toFixed(4)}` : "未配置费率"}
            </dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  )
}

export function RunStatistics({ value }: { value: ConversationStatistics }) {
  const { showPerformance, showUsage, cacheHit } = readRunStatistics(value)
  return (
    <>
      {showPerformance && <PerformanceStatistics value={value} />}
      {showUsage && <TokenStatistics value={value} cacheHit={cacheHit} />}
    </>
  )
}
