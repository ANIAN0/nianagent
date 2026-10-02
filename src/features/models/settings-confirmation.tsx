import { Button } from "@/components/ui/button"
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
  onCancel,
  onConfirm,
  onCancelRequest,
}: {
  value?: SettingsConfirmation
  busy?: boolean
  error?: string
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
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
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
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "正在处理…" : value?.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
