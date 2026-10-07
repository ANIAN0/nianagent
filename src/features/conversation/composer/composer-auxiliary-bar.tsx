import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { FeedbackDescription } from "@/lib/operation-issue"
import {
  ContextUsage,
  readContextUsage,
  type ContextUsageProps,
} from "./context-usage"
import type { ReactNode } from "react"
import { RunStatistics, readRunStatistics } from "./run-statistics"
import type { ConversationStatistics } from "@/features/models/model-contract.generated"
import "./composer.css"

export type ComposerAuxiliaryBarProps = {
  context?: ContextUsageProps
  statistics?: ConversationStatistics
  modeIssue?: FeedbackDescription
  onCheckMode?: () => void
  modeChecking?: boolean
  recovery?: ReactNode
}

/** DSH keeps the input footer for usage; legacy operation recovery remains reachable. */
export function ComposerAuxiliaryBar({
  context,
  statistics,
  modeIssue,
  onCheckMode,
  modeChecking,
  recovery,
}: ComposerAuxiliaryBarProps) {
  const unknown =
    modeIssue?.code === "result_unknown" || modeIssue?.recovery === "check"
  const showContext = !!context && !!readContextUsage(context)
  const statisticsReading = statistics && readRunStatistics(statistics)
  const showStatistics =
    !!statisticsReading &&
    (statisticsReading.showPerformance || statisticsReading.showUsage)
  const showControls = showContext || showStatistics
  if (!showControls && !modeIssue && !recovery) return null
  return (
    <div className="composer-auxiliary" aria-label="会话辅助信息">
      {showControls && (
        <div className="composer-auxiliary-controls">
          <div className="composer-auxiliary-insights">
            {showStatistics && statistics && (
              <RunStatistics value={statistics} />
            )}
            {showContext && context && <ContextUsage {...context} />}
          </div>
        </div>
      )}
      {recovery}
      {modeIssue && (
        <OperationFeedback
          notify={false}
          title={unknown ? "交付设置待确认" : "交付设置未保存"}
          {...modeIssue}
          severity={unknown ? "warning" : (modeIssue.severity ?? "error")}
          actions={
            <RecoveryAction
              issue={modeIssue}
              disabled={
                modeChecking &&
                ["check", "reload"].includes(modeIssue.recovery ?? "check")
              }
              onCheck={onCheckMode}
              onReload={onCheckMode}
              labels={{ check: "核对交付设置", reload: "重新读取交付设置" }}
            />
          }
        />
      )}
    </div>
  )
}
