import { LoaderCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
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

export type CompactDialogProps = {
  open: boolean
  title: string
  model: string
  messageCount: number
  focus: string
  operation?: ConversationControlOperation
  error?: string
  pending?: boolean
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
  pending,
  disabledReason,
  onOpenChange,
  onFocusChange,
  onStart,
  onCancel,
  onCheck,
}: CompactDialogProps) {
  const active =
    operation?.kind === "compact" &&
    ["running", "cancelling", "unknown"].includes(operation.status)
  const completed =
    operation?.kind === "compact" && operation.status === "completed"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>压缩当前上下文</DialogTitle>
          <DialogDescription>
            保留重点后继续工作。完整会话历史仍可查看。
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">会话</dt>
          <dd className="wrap-break-word">{title}</dd>
          <dt className="text-muted-foreground">模型</dt>
          <dd className="wrap-break-word">{model || "尚未选择"}</dd>
          <dt className="text-muted-foreground">记录范围</dt>
          <dd>当前会话路径 · {messageCount} 条消息</dd>
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
        {(error || operation?.error) && (
          <Alert variant="destructive">
            <AlertDescription>{error || operation?.error}</AlertDescription>
          </Alert>
        )}
        {active && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            {operation?.status === "cancelling"
              ? "正在取消压缩"
              : operation?.status === "unknown"
                ? "压缩结果待确认"
                : "正在压缩上下文"}
          </p>
        )}
        {completed && (
          <p role="status" className="text-sm">
            压缩已完成，摘要已保存。压缩后占用待更新。
          </p>
        )}
        {!active && !completed && disabledReason && (
          <p className="text-sm text-muted-foreground">{disabledReason}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {" "}
            {active ? "返回会话" : completed ? "关闭" : "取消"}
          </Button>
          {active ? (
            <>
              <Button variant="outline" disabled={pending} onClick={onCheck}>
                检查压缩状态
              </Button>
              {operation?.status !== "unknown" && (
                <Button
                  disabled={pending || operation?.status === "cancelling"}
                  onClick={onCancel}
                >
                  取消压缩
                </Button>
              )}
            </>
          ) : (
            !completed && (
              <Button disabled={pending || !!disabledReason} onClick={onStart}>
                {operation?.status === "failed" ? "重新压缩" : "开始压缩"}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
