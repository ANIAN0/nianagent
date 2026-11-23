import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { StatusMessage } from "@/components/feedback/status-message"
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

export function ComposerRecoveryCard({
  title,
  message,
  code,
  details,
  severity = "warning",
  actions,
}: {
  title: string
  message: string
  code?: string
  details?: string
  severity?: "error" | "warning" | "info"
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const fullDetails = [code ? `状态码：${code}` : undefined, details]
    .filter(Boolean)
    .join("\n")
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="composer-recovery-card"
      data-severity={severity}
    >
      <div className="composer-recovery-card-row">
        <div className="composer-recovery-card-copy">
          <StatusMessage title={title} message={message} severity={severity} />
        </div>
        {(actions || fullDetails) && (
          <div
            className="composer-recovery-card-actions"
            role="group"
            aria-label={`${title}：${message}`}
          >
            {actions}
            {fullDetails && (
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="composer-recovery-details-trigger"
                  data-open={open || undefined}
                >
                  {open ? "收起详情" : "详情"}
                  <ChevronDown data-icon="inline-end" />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
        )}
      </div>
      {fullDetails && (
        <CollapsibleContent>
          <pre className="composer-recovery-card-details">{fullDetails}</pre>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

/** Original identities stay reachable above the composer after their queue rows have disappeared. */
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
        <ComposerRecoveryCard
          title="本机队列恢复记录需要处理"
          message={storageIssue.message}
          code={storageIssue.code}
          details={storageIssue.details}
          severity={storageIssue.severity ?? "warning"}
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
        const details = [
          issue?.details,
          `原请求：${record.operationRequestId}`,
          `原版本：${record.revision}`,
          record.itemId
            ? `原消息：${record.itemId}`
            : `原设置：${record.mode === "all" ? "全部交付" : "逐条交付"}`,
        ]
          .filter(Boolean)
          .join("\n")
        return (
          <ComposerRecoveryCard
            key={record.operationRequestId}
            title={active ? `正在处理${label}` : `${label}待核对`}
            message={
              active
                ? "正在等待原操作结果，原请求身份已保留。"
                : (issue?.message ??
                  "原操作结果尚未确认；读取原回执后才能开始新的修改。")
            }
            code={issue?.code}
            details={details}
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
