import { Button } from "@/components/ui/button"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { FeedbackDescription } from "@/lib/operation-issue"
import {
  queueOperationIssueKey,
  type QueueOperationRecord,
} from "../queue-operation-recovery"

export type QueueOperationRecoveryProps = {
  records: readonly QueueOperationRecord[]
  issues?: Record<string, FeedbackDescription | undefined>
  issuesByRequest?: Record<string, FeedbackDescription | undefined>
  retryAllowed?: Record<string, boolean | undefined>
  checking?: boolean
  restoring?: boolean
  processing?: Record<string, boolean | undefined>
  storageIssue?: FeedbackDescription
  onCheck: () => void
  onRestore?: (record: QueueOperationRecord) => void
}

/** Original identities stay reachable after their queue rows have disappeared. */
export function QueueOperationRecovery({
  records,
  issues = {},
  issuesByRequest = {},
  retryAllowed = {},
  checking,
  restoring,
  processing = {},
  storageIssue,
  onCheck,
  onRestore,
}: QueueOperationRecoveryProps) {
  if (!records.length && !storageIssue) return null
  return (
    <div className="composer-queue-recovery" aria-label="原队列操作恢复">
      {storageIssue && (
        <OperationFeedback
          notify={false}
          title="本机队列恢复记录需要处理"
          {...storageIssue}
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={checking}
              onClick={onCheck}
            >
              {checking ? "正在核对…" : "重新读取恢复记录"}
            </Button>
          }
        />
      )}
      {records.map((record) => {
        const issue =
          issuesByRequest[record.operationRequestId] ??
          issues[queueOperationIssueKey(record)]
        const active = !!processing[record.operationRequestId]
        const label =
          record.operation === "conversationQueueMode"
            ? "交付设置"
            : record.operation === "conversationQueueRemove"
              ? "移除消息"
              : "发送排队消息"
        return (
          <OperationFeedback
            notify={false}
            key={record.operationRequestId}
            title={active ? `正在处理${label}` : `${label}的原操作待核对`}
            message={
              active
                ? "正在等待原操作结果，原请求身份已保留。"
                : (issue?.message ??
                  "原操作结果尚未确认；读取原回执后才能开始新的修改。")
            }
            details={[
              issue?.details,
              `原请求：${record.operationRequestId}`,
              `原版本：${record.revision}`,
              record.itemId
                ? `原消息：${record.itemId}`
                : `原设置：${record.mode === "all" ? "全部交付" : "逐条交付"}`,
            ]
              .filter(Boolean)
              .join("\n")}
            severity={active ? "info" : (issue?.severity ?? "warning")}
            actions={
              <>
                <RecoveryAction
                  issue={
                    issue ?? {
                      code: "result_unknown",
                      message: "原操作尚未确认。",
                      recovery: "check",
                    }
                  }
                  disabled={checking || active}
                  onCheck={onCheck}
                  onReload={onCheck}
                  labels={{
                    check: checking ? "正在核对…" : "核对原操作",
                    reload: checking ? "正在核对…" : "核对原操作",
                  }}
                />
                {retryAllowed[record.operationRequestId] &&
                  issue?.recovery !== "restart" &&
                  onRestore && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={checking || restoring}
                      onClick={() => onRestore(record)}
                    >
                      恢复原操作
                    </Button>
                  )}
              </>
            }
          />
        )
      })}
    </div>
  )
}
