import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { SubmissionReceipt } from "@/components/feedback/submission-receipt"
import { ComposerNotification } from "@/components/composer/composer-notification"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import type { HomeSubmission } from "@/features/conversation/conversation-draft-store"
import type { FeedbackDescription } from "@/lib/operation-issue"
import type { Material } from "./home-types"

/** The original submission keeps its recovery outside the editable input. */
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
  const message = checking
    ? "正在核对原消息的接收状态。"
    : (issue?.message ?? "原消息的接收结果暂未确认，下一稿已保留。")
  return (
    <>
      {!inactive && issue && !checking && (
        <ComposerNotification message={message} trigger={issue} tone="warning" />
      )}
      <SubmissionReceipt
        checking={checking}
        disabled={inactive || recovering}
        onCheck={onCheck}
        actions={
          <>
            {issue && ![undefined, "check", "retry", "reload"].includes(issue.recovery) && (
              <RecoveryAction issue={issue} onSettings={onSettings} variant="ghost" disabled={inactive || checking} />
            )}
            {submission && (
              <Button type="button" variant="ghost" size="xs" disabled={inactive} onClick={() => setShowOriginal(true)}>
                {recovering ? "查看待恢复原输入" : "查看原提交"}
              </Button>
            )}
          </>
        }
      />
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
