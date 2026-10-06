import { useState } from "react"
import { LoaderCircle, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InputGroupButton } from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { HoverHint } from "@/components/feedback/hover-hint"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import type { HomeSubmission } from "@/features/conversation/conversation-draft-store"
import type { FeedbackDescription } from "@/lib/operation-issue"
import type { Material } from "./home-types"
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "./composer-panel-context"

/** Recovery belongs to the send operation, not to a homepage message history. */
export function HomeSubmissionEcho({
  submission,
  workspacePath,
  recovering = false,
  checking = false,
  onCheck,
  issue,
  onSettings,
  inactive = false,
}: {
  submission?: HomeSubmission
  workspacePath: string
  recovering?: boolean
  checking?: boolean
  onCheck?: () => void
  issue?: FeedbackDescription
  onSettings?: () => void
  inactive?: boolean
}) {
  const [open, setOpen] = useComposerPanel("submission-recovery")
  const closeAutoFocus = useComposerPanelCloseAutoFocus("submission-recovery")
  const [showOriginal, setShowOriginal] = useState(false)
  const [preview, setPreview] = useState<Material | null>(null)
  const [wasInactive, setWasInactive] = useState(inactive)
  if (wasInactive !== inactive) {
    setWasInactive(inactive)
    if (inactive) {
      setShowOriginal(false)
      setPreview(null)
    }
  }
  const label = recovering ? "查看待恢复原输入" : "核对原消息"
  const message = checking
    ? "正在核对原消息的接收状态。"
    : (issue?.message ?? "原消息的接收结果暂未确认，下一稿已保留。")
  return (
    <>
      <Popover open={!inactive && open && !showOriginal} onOpenChange={setOpen}>
        <HoverHint content={label} suppressed={open || showOriginal}>
          <PopoverTrigger asChild>
            <InputGroupButton
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-[34px] rounded-full bg-muted text-foreground"
              aria-label={label}
              aria-busy={checking || undefined}
              disabled={inactive}
            >
              {checking ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <TriangleAlert className="size-4 text-status-warning" />
              )}
            </InputGroupButton>
          </PopoverTrigger>
        </HoverHint>
        <PopoverContent
          side="top"
          align="end"
          collisionPadding={12}
          sideOffset={8}
          onCloseAutoFocus={closeAutoFocus}
          className="w-80 max-w-[calc(100vw-24px)] rounded-xl p-3"
          aria-label="原消息发送状态"
        >
          <OperationFeedback
            density="compact"
            title="发送状态待核对"
            message={message}
            severity="warning"
            actions={
              <>
                {!checking && onCheck && (
                  <RecoveryAction
                    variant="ghost"
                    issue={{
                      ...issue,
                      code: issue?.code ?? "result_unknown",
                      message,
                      recovery: issue?.recovery ?? "check",
                    }}
                    onCheck={onCheck}
                    onReload={onCheck}
                    onRetry={onCheck}
                    onSettings={onSettings}
                    labels={{
                      check: "检查发送状态",
                      reload: "重新读取发送状态",
                      retry: "重新读取发送状态",
                    }}
                  />
                )}
                {submission && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setOpen(false)
                      setShowOriginal(true)
                    }}
                  >
                    查看原提交
                  </Button>
                )}
              </>
            }
          />
        </PopoverContent>
      </Popover>
      <Dialog open={!inactive && showOriginal} onOpenChange={setShowOriginal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>原提交</DialogTitle>
            <DialogDescription>
              核对这条消息的接收结果；后续草稿保持独立。
            </DialogDescription>
          </DialogHeader>
          <div className="moon-scrollbar max-h-[50dvh] min-w-0 overflow-y-auto text-sm leading-6 [overflow-wrap:anywhere]">
            <p className="whitespace-pre-wrap">
              {submission?.draft.text || "（仅材料）"}
            </p>
            {!!submission?.draft.materials.length && (
              <div className="mt-3 flex flex-wrap gap-2">
                {submission.draft.materials.map((material) => (
                  <Button
                    key={material.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="max-w-full"
                    disabled={material.status !== "ready"}
                    onClick={() => setPreview(material)}
                  >
                    <span className="truncate">{material.name}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <MaterialPreviewDialog
        material={inactive ? null : preview}
        cwd={workspacePath}
        onClose={() => setPreview(null)}
      />
    </>
  )
}
