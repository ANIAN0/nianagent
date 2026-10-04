import { LoaderCircle } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import type { ConversationControlOperation } from "@/features/models/model-contract.generated"
import { feedbackFromError } from "@/lib/operation-issue"
import type { ConversationControlAction } from "./use-conversation-controls"

export type CompactDialogProps = {
  open: boolean
  title: string
  model: string
  messageCount: number
  focus: string
  operation?: ConversationControlOperation
  error?: string
  issue?: {
    message: string
    details?: string
    action?: ConversationControlAction
    uncertain?: boolean
  }
  pending?: boolean
  pendingAction?: ConversationControlAction
  disabledReason?: string
  onOpenChange: (open: boolean) => void
  onFocusChange: (focus: string) => void
  onStart: () => void
  onCancel: () => void
  onCheck: () => void
}
export function CompactDialog({
  open,
  title,
  model,
  messageCount,
  focus,
  operation,
  error,
  issue,
  pending,
  pendingAction,
  disabledReason,
  onOpenChange,
  onFocusChange,
  onStart,
  onCancel,
  onCheck,
}: CompactDialogProps) {
  const current = operation?.kind === "compact" ? operation : undefined
  const active =
    !!current && ["running", "cancelling", "unknown"].includes(current.status)
  const completed = current?.status === "completed"
  const cancelled = current?.status === "cancelled"
  const failed = current?.status === "failed"
  const unknown =
    current?.status === "unknown" ||
    (issue?.action === "cancel" && issue.uncertain)
  const feedback =
    issue ??
    (error || (!cancelled && current?.error)
      ? feedbackFromError(error || current?.error)
      : failed
        ? {
            message: "本次压缩未完成，原上下文与历史保留。",
            details: undefined,
          }
        : undefined)
  const submissionPending = pending && pendingAction === "compact"
  const checking = pending && pendingAction === "check"
  const cancelling =
    current?.status === "cancelling" || (pending && pendingAction === "cancel")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>压缩当前上下文</DialogTitle>
          <DialogDescription>
            整理当前上下文，为后续工作保留重点。原会话历史仍可查看。
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">会话</dt>
          <dd className="wrap-break-word">{title}</dd>
          <dt className="text-muted-foreground">模型</dt>
          <dd className="wrap-break-word">{model || "尚未选择"}</dd>
          <dt className="text-muted-foreground">范围</dt>
          <dd>当前会话 · {messageCount} 条消息</dd>
        </dl>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="compact-focus">
              希望保留的重点（可选）
            </FieldLabel>
            <Textarea
              id="compact-focus"
              rows={4}
              value={focus}
              disabled={active || pending}
              onChange={(event) => onFocusChange(event.target.value)}
              placeholder="例如：任务目标、已完成工作、待解决问题"
            />
            <FieldDescription>
              留空时由当前模型整理。压缩会产生一次模型调用。
            </FieldDescription>
          </Field>
        </FieldGroup>
        {unknown && !submissionPending ? (
          <OperationFeedback
            title={
              issue?.action === "cancel" ? "取消结果待确认" : "压缩结果待确认"
            }
            message={
              feedback?.message ||
              "尚未确认摘要是否保存。请先检查结果，避免重复压缩。"
            }
            details={feedback?.details}
            severity="warning"
          />
        ) : feedback && !completed ? (
          <OperationFeedback
            title={
              issue?.action === "cancel"
                ? "取消压缩未生效"
                : issue?.action === "check"
                  ? "暂时无法检查压缩状态"
                  : "压缩未完成"
            }
            message={feedback.message}
            details={feedback.details}
            severity={active ? "warning" : "error"}
          />
        ) : completed ? (
          <OperationFeedback
            title="上下文已压缩"
            message="摘要已加入会话记录，原历史仍可查看。压缩后用量待更新。"
            severity="info"
          />
        ) : cancelled ? (
          <OperationFeedback
            title="压缩已取消"
            message="原上下文与历史保留，可以修改重点后重新开始。"
            severity="info"
          />
        ) : null}
        {active && (!unknown || submissionPending) && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {cancelling
              ? "正在取消压缩"
              : submissionPending
                ? "正在提交压缩请求"
                : "正在整理上下文"}
          </p>
        )}
        {!active && !completed && disabledReason && (
          <p className="text-sm text-muted-foreground">{disabledReason}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {active ? "返回会话" : completed ? "关闭" : "取消"}
          </Button>
          {active ? (
            <>
              <Button
                variant={unknown ? "default" : "outline"}
                disabled={pending}
                onClick={onCheck}
              >
                {checking && (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin motion-reduce:animate-none"
                  />
                )}
                {checking ? "正在检查" : "检查压缩状态"}
              </Button>
              {!unknown && (
                <Button
                  variant="outline"
                  disabled={pending || cancelling}
                  onClick={onCancel}
                >
                  取消压缩
                </Button>
              )}
            </>
          ) : (
            !completed && (
              <Button disabled={pending || !!disabledReason} onClick={onStart}>
                {failed || cancelled ? "重新压缩" : "开始压缩"}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
