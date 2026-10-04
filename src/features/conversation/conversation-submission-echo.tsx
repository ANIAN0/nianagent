import { LoaderCircle, RotateCcw } from "lucide-react"
import { UserMessage } from "./messages/user-message"
import type { ConversationSubmissionEchoValue } from "./conversation-submission"

export function ConversationSubmissionEcho({
  submission,
  workspacePath,
  pending = false,
  unconfirmed = false,
}: {
  submission: ConversationSubmissionEchoValue
  workspacePath?: string
  pending?: boolean
  unconfirmed?: boolean
}) {
  if (submission.kind === "retry") {
    const Icon = pending ? LoaderCircle : RotateCcw
    return (
      <div
        role="status"
        aria-label={pending ? "正在请求继续回复" : "继续请求结果待核对"}
        className="flex items-start gap-2 px-1 py-2 text-sm text-muted-foreground"
      >
        <Icon
          aria-hidden="true"
          className={
            pending
              ? "mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
              : "mt-0.5 size-4 shrink-0"
          }
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-foreground">
            {pending ? "正在继续上次回复…" : "继续上次回复的接收结果待核对"}
          </p>
          <p>输入框中的下一稿和材料已保留，未随此次继续请求发送。</p>
        </div>
      </div>
    )
  }
  return (
    <div
      className="conversation-pending-submission"
      role="status"
      aria-label={unconfirmed ? "发送结果待核对" : "正在提交消息"}
    >
      <UserMessage
        showActions={false}
        workspacePath={workspacePath}
        message={{
          id: submission.id,
          role: "user",
          status: "sending",
          text: submission.draft.text,
          attachments: submission.draft.materials.map((material) => ({
            ...material,
            kind:
              material.type === "image"
                ? ("image" as const)
                : ("file" as const),
            materialType: material.type,
          })),
        }}
      />
      <p>
        {unconfirmed
          ? "发送结果待核对，正在保留本次消息副本。"
          : "正在提交消息，尚未收到接收确认。"}
      </p>
    </div>
  )
}
