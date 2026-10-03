import type { ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

export default function NavigationDialog({
  children,
  onOpenChange,
  onReturnFocus,
}: {
  children: ReactNode
  onOpenChange: (open: boolean) => void
  onReturnFocus: () => void
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="api-navigation-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onReturnFocus()
        }}
      >
        <DialogTitle>接口导航</DialogTitle>
        <DialogDescription>
          按模块或接口名称定位。切换接口保留本页草稿，并取消仍在等待的调用。
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  )
}
