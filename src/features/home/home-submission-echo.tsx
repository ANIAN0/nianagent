import { UserMessage } from "@/features/conversation/messages/user-message"
import type { HomeSubmission } from "@/features/conversation/conversation-draft-store"
import { LoaderCircle, TriangleAlert } from "lucide-react"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { useState } from "react"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import type { Material } from "./home-types"

/** A local submission copy uses the same surface as the eventual user message. */
export function HomeSubmissionEcho({
  submission,
  workspacePath,
  accepted = false,
  recovering = false,
  checking = false,
  unresolved = false,
  onCheck,
  issue,
  onSettings,
  inactive = false,
}: {
  submission: HomeSubmission
  workspacePath: string
  accepted?: boolean
  recovering?: boolean
  checking?: boolean
  unresolved?: boolean
  onCheck?: () => void
  issue?: FeedbackDescription
  onSettings?: () => void
  inactive?: boolean
}) {
  const [preview, setPreview] = useState<Material | null>(null)
  const [wasInactive, setWasInactive] = useState(inactive)
  if (wasInactive !== inactive) {
    setWasInactive(inactive)
    if (inactive) setPreview(null)
  }
  return (
    <div className="mb-4">
      <div
        aria-label={
          recovering
            ? "待恢复的原输入"
            : accepted
              ? "已接收的提交副本"
              : "正在确认的提交副本"
        }
        tabIndex={0}
        className="moon-scrollbar max-h-[min(220px,30dvh)] overflow-y-auto"
      >
        <UserMessage
          onOpenAttachment={(attachment) => {
            if (inactive) return
            setPreview(
              submission.draft.materials.find(
                (material) => material.id === attachment.id
              ) ?? null
            )
          }}
          showActions={false}
          workspacePath={workspacePath}
          message={{
            id: `home-local:${submission.sessionId}`,
            role: "user",
            text: submission.draft.text,
            status: accepted || recovering ? "settled" : "sending",
            attachments: submission.draft.materials.map((material) => ({
              id: material.id,
              name: material.name,
              kind: material.type === "image" ? "image" : "file",
              materialType: material.type,
              source: material.source,
              bytes: material.bytes,
              url: material.thumbnail,
            })),
          }}
        />
      </div>
      {!accepted && (checking || unresolved) && (
        <div
          role="status"
          className="mt-2 flex flex-wrap items-center justify-end gap-2 text-xs leading-5 text-muted-foreground"
        >
          {checking ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <TriangleAlert
              aria-hidden="true"
              className="size-3.5 text-status-warning"
            />
          )}
          <span>
            {checking
              ? "正在核对原消息…"
              : (issue?.message ??
                "原消息的接收结果暂未确认，下一条输入已保留。")}
          </span>
          {!checking && onCheck && (
            <RecoveryAction
              issue={{
                ...issue,
                code: issue?.code ?? "result_unknown",
                message: issue?.message ?? "",
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
        </div>
      )}
      <MaterialPreviewDialog
        material={inactive ? null : preview}
        cwd={workspacePath}
        history={accepted}
        onClose={() => setPreview(null)}
      />
    </div>
  )
}
