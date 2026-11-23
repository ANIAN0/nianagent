import {
  ContextUsage,
  readContextUsage,
  type ContextUsageProps,
} from "./context-usage"
import type { ReactNode } from "react"
import { RunStatistics, readRunStatistics } from "./run-statistics"
import type { ConversationStatistics } from "@/contracts/rpc.generated"
import "./composer.css"

export type ComposerAuxiliaryBarProps = {
  context?: ContextUsageProps
  statistics?: ConversationStatistics
  deliveryControl?: ReactNode
}

/** Input footer stays dedicated to lightweight usage, statistics, and run delivery controls. */
export function ComposerAuxiliaryBar({
  context,
  statistics,
  deliveryControl,
}: ComposerAuxiliaryBarProps) {
  const showContext = !!context && !!readContextUsage(context)
  const statisticsReading = statistics && readRunStatistics(statistics)
  const showStatistics =
    !!statisticsReading &&
    (statisticsReading.showPerformance || statisticsReading.showUsage)
  const showControls = showContext || showStatistics || !!deliveryControl
  if (!showControls) return null
  return (
    <div className="composer-auxiliary" aria-label="会话辅助信息">
      <div className="composer-auxiliary-controls">
        {deliveryControl}
        <div className="composer-auxiliary-insights">
          {showStatistics && statistics && <RunStatistics value={statistics} />}
          {showContext && context && <ContextUsage {...context} />}
        </div>
      </div>
    </div>
  )
}
