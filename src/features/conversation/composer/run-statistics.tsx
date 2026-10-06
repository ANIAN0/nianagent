import { Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import type { ConversationStatistics } from "@/features/models/model-contract.generated"
export function RunStatistics({ value }: { value: ConversationStatistics }) {
  const format = (count: number) => count.toLocaleString()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="composer-auxiliary-trigger"
          aria-label="运行统计"
        >
          <Gauge data-icon="inline-start" />
          {format(value.totalTokens)} tokens
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="center">
        <div className="mb-3 text-sm font-medium">
          会话统计{value.restored && " · 历史恢复"}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <dt>输入 / 输出</dt>
          <dd className="text-right tabular-nums">
            {format(value.input)} / {format(value.output)}
          </dd>
          <dt>缓存读取 / 写入</dt>
          <dd className="text-right tabular-nums">
            {format(value.cacheRead)} / {format(value.cacheWrite)}
          </dd>
          <dt>工具调用</dt>
          <dd className="text-right">{value.toolCalls}</dd>
          {value.durationMs !== undefined && (
            <>
              <dt>本轮总耗时</dt>
              <dd className="text-right">
                {(value.durationMs / 1000).toFixed(1)} 秒
              </dd>
            </>
          )}
          {value.modelDurationMs !== undefined && (
            <>
              <dt>模型生成耗时</dt>
              <dd className="text-right">
                {(value.modelDurationMs / 1000).toFixed(1)} 秒
              </dd>
            </>
          )}
          <dt>本轮生成速度</dt>
          <dd className="text-right">
            {value.tokensPerSecond !== undefined
              ? `${value.tokensPerSecond.toFixed(1)} tokens/s（估算）`
              : "等待用量返回"}
          </dd>
          <dt>费用估算</dt>
          <dd className="text-right">
            {value.cost !== undefined
              ? `$${value.cost.toFixed(4)}`
              : "未配置费率"}
          </dd>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          用量来自
          Pi／模型提供者；费用按配置费率估算。运行结束不代表任务已验收。
        </p>
      </PopoverContent>
    </Popover>
  )
}
