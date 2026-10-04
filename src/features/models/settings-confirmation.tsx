import { Button } from "@/components/ui/button"
import type { ReactNode } from "react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
export type SettingsConfirmation = {
  title: string
  description: string
  label: string
  destructive?: boolean
  action: () => void | Promise<void>
}
export function SettingsConfirmDialog({
  value,
  busy,
  error,
  errorTitle = "操作未完成",
  errorDetails,
  errorSeverity = "error",
  errorActions,
  confirmDisabled = false,
  busyMessage = "正在处理…",
  onCancel,
  onConfirm,
  onCancelRequest,
}: {
  value?: SettingsConfirmation
  busy?: boolean
  error?: string
  errorTitle?: string
  errorDetails?: string
  errorSeverity?: "error" | "warning" | "info"
  errorActions?: ReactNode
  confirmDisabled?: boolean
  busyMessage?: string
  onCancel: () => void
  onCancelRequest?: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={!!value}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <DialogContent
        className="sm:max-w-[480px]"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault()
        }}
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>{value?.title}</DialogTitle>
          <DialogDescription>{value?.description}</DialogDescription>
        </DialogHeader>
        {error && (
          <OperationFeedback
            title={errorTitle}
            message={error}
            details={errorDetails}
            severity={errorSeverity}
            actions={errorActions}
          />
        )}
        <DialogFooter>
          {busy && onCancelRequest && (
            <Button variant="outline" onClick={onCancelRequest}>
              取消请求
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            {value?.title.startsWith("放弃") ? "继续编辑" : "取消"}
          </Button>
          <Button
            variant={value?.destructive ? "destructive" : "default"}
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {busy ? busyMessage : value?.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
