import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { ReadOnlyPatch } from "@/components/read-only-patch"
import { ProjectDialog } from "./panel-controls"
import type { Preview } from "./service"

export function PreviewDialog({
  projectName,
  preview,
  pending,
  error,
  onClose,
  onApply,
}: {
  projectName: string
  preview?: Preview
  pending: boolean
  error: string
  onClose: () => void
  onApply: () => void
}) {
  return (
    <ProjectDialog
      open={!!preview}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
      title={`确认修改 ${projectName} 的配置`}
    >
      <div className="max-h-[55vh] overflow-auto">
        {preview?.format === "diff" ? (
          <ReadOnlyPatch legacyDiff={preview.diff || "正文没有差异"} />
        ) : (
          <p className="break-all whitespace-pre-wrap">{preview?.diff}</p>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <DialogFooter>
        <Button disabled={pending} onClick={onApply}>
          应用到项目
        </Button>
      </DialogFooter>
    </ProjectDialog>
  )
}
