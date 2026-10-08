import type { Material } from "@/features/home/home-types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { fileReferenceFeedback } from "@/features/materials/material-reference-feedback"

/** Unready inline references keep their recovery at the reference, not in a second card. */
export function ReferenceStatusDialog({
  material,
  onClose,
  onRetry,
  canRetry,
  retryLabel,
  onRemove,
}: {
  material: Material | null
  onClose(): void
  onRetry?(id: string): void
  canRetry?(material: Material): boolean
  retryLabel?(material: Material): string
  onRemove?(id: string): void
}) {
  const preparing = material?.status === "preparing"
  const reference = material ? fileReferenceFeedback(material) : undefined
  return (
    <Dialog
      open={!!material}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{material?.name}</DialogTitle>
          <DialogDescription>
            {reference?.description ??
              (preparing ? "材料准备中" : "材料准备失败")}
          </DialogDescription>
        </DialogHeader>
        <OperationFeedback
          notify={false}
          density="compact"
          title={reference ? "引用状态" : "材料状态"}
          severity={preparing ? "info" : "error"}
          message={
            reference?.message ??
            (preparing
              ? "正在准备，完成后可发送。"
              : material?.error || "材料未能准备，请重新选择或移除。")
          }
          actions={
            material && (
              <>
                {!preparing &&
                  onRetry &&
                  (canRetry?.(material) ?? material.retryable !== false) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onRetry(material.id)}
                    >
                      {reference
                        ? "重新检查"
                        : (retryLabel?.(material) ?? "重试准备")}
                    </Button>
                  )}
                {onRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onRemove(material.id)
                      onClose()
                    }}
                  >
                    移除引用
                  </Button>
                )}
              </>
            )
          }
        />
      </DialogContent>
    </Dialog>
  )
}
