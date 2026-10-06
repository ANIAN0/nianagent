import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { ContextUsage, type ContextUsageProps } from "./context-usage"
import { QueueDeliveryControl } from "./queue-delivery-control"
import type { ReactNode } from "react"
import { RunInputControl, type BusyInputMode } from "./run-input-control"
import { RunStatistics } from "./run-statistics"
import type { ConversationStatistics } from "@/features/models/model-contract.generated"
import "./composer.css"

export type ComposerAuxiliaryBarProps = {
  context?: ContextUsageProps
  statistics?: ConversationStatistics
  busyInputMode?: BusyInputMode
  onBusyInputModeChange?: (mode: BusyInputMode) => void
  deliveryMode?: "single" | "all"
  queuedCount?: number
  onDeliveryModeChange?: (mode: "single" | "all") => void | Promise<unknown>
  modeIssue?: FeedbackDescription
  onCheckMode?: () => void
  modeDisabledReason?: string
  modeChecking?: boolean
  recovery?: ReactNode
}

/** Card and dock share one owner; queue count never moves the delivery control. */
export function ComposerAuxiliaryBar({
  context,
  statistics,
  busyInputMode = "followUp",
  onBusyInputModeChange,
  deliveryMode = "single",
  queuedCount = 0,
  onDeliveryModeChange,
  modeIssue,
  onCheckMode,
  modeDisabledReason,
  modeChecking,
  recovery,
}: ComposerAuxiliaryBarProps) {
  const unknown =
    modeIssue?.code === "result_unknown" || modeIssue?.recovery === "check"
  const disabledReason = unknown
    ? "交付设置的保存结果尚未确认，请先核对原操作。"
    : modeDisabledReason
  if (
    !context &&
    !statistics &&
    !onBusyInputModeChange &&
    !onDeliveryModeChange &&
    !modeIssue &&
    !recovery
  )
    return null
  return (
    <div className="composer-auxiliary" aria-label="对话输入辅助设置">
      <div className="composer-auxiliary-controls">
        <div className="composer-auxiliary-actions">
          {onBusyInputModeChange && (
            <RunInputControl
              mode={busyInputMode}
              onChange={onBusyInputModeChange}
            />
          )}
          {onDeliveryModeChange && (
            <QueueDeliveryControl
              mode={deliveryMode}
              disabled={!!disabledReason}
              disabledReason={disabledReason}
              queuedCount={queuedCount}
              onChange={onDeliveryModeChange}
            />
          )}
        </div>
        <div className="composer-auxiliary-insights">
          {context && <ContextUsage {...context} />}
          {statistics && <RunStatistics value={statistics} />}
        </div>
      </div>
      {recovery}
      {modeIssue && (
        <OperationFeedback
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
