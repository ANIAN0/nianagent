import type { MutableRefObject, RefObject } from "react"
import type { ComposerEditorElement } from "@/components/composer/composer-editor-contract"
import type {
  ConversationSnapshot,
  OperationIssue,
} from "@/contracts/rpc.generated"
import type { ComposerDraft } from "@/lib/composer/types"
import type { FeedbackDescription } from "@/lib/operation-issue"
import type { ConversationSubmissionEchoValue } from "./conversation-submission"
import { QueueDock } from "./composer/queue-dock"
import type { QueueDockProps } from "./composer/queue-dock.types"
import type { LiveConversationQueueProps } from "./live-conversation-view"

export function ConversationQueuePanel({
  id,
  snapshot,
  draft,
  latestDraft,
  inputRef,
  mounted,
  pending,
  receiptUnknown,
  readPending,
  running,
  stopping,
  mutationBlockedReason,
  hasApproval,
  pendingSubmission,
  queueIssue,
  queueIssues,
  currentQueueIssues,
  onReload,
  onReconcile,
  onChange,
  onRecoverDraft,
  queue,
}: {
  id: string
  snapshot?: ConversationSnapshot
  draft: ComposerDraft
  latestDraft: MutableRefObject<ComposerDraft>
  inputRef: RefObject<ComposerEditorElement | null>
  mounted: MutableRefObject<boolean>
  pending?: boolean
  receiptUnknown: boolean
  readPending?: boolean
  running: boolean
  stopping: boolean
  mutationBlockedReason?: string
  hasApproval: boolean
  pendingSubmission?: ConversationSubmissionEchoValue
  queueIssue?: OperationIssue
  queueIssues?: Record<string, FeedbackDescription | undefined>
  currentQueueIssues: NonNullable<QueueDockProps["issues"]>
  onReload: () => void
  onReconcile?: () => void
  onChange: (draft: ComposerDraft) => void
  onRecoverDraft?: (draft: ComposerDraft) => void | Promise<unknown>
  queue: Pick<
    LiveConversationQueueProps,
    "onItemRead" | "onEdit" | "onRemove" | "onDeliver"
  >
}) {
  if (!snapshot?.queue || !queue.onEdit || !queue.onRemove || !queue.onDeliver)
    return null

  const activePendingSubmission =
    pendingSubmission?.kind === "send" &&
    pendingSubmission.placement === "queued" &&
    !snapshot.queue.acceptedRequestIds?.includes(pendingSubmission.id) &&
    !(
      snapshot.inputAccepted &&
      snapshot.clientRequestId === pendingSubmission.id
    )
      ? pendingSubmission
      : undefined

  return (
    <QueueDock
      sessionId={id}
      pendingSubmission={activePendingSubmission}
      pending={pending && !receiptUnknown}
      unconfirmed={receiptUnknown}
      checking={receiptUnknown && pending}
      onCheckSubmission={onReconcile}
      retiredItems={snapshot.queue.retiredItems}
      onReadItem={queue.onItemRead}
      revision={snapshot.queue.revision}
      items={snapshot.queue.items.map((item) => ({
        ...item,
        draft: {
          ...draft,
          text: item.text,
          materials: item.materials,
        },
      }))}
      running={running}
      stopping={stopping}
      busy={stopping || !!mutationBlockedReason}
      checkPending={readPending}
      paused={snapshot.queue.paused}
      waitingApproval={hasApproval}
      cwd={snapshot.cwd}
      issue={
        queueIssue &&
        !Object.values(queueIssues ?? {}).some(
          (issue) => issue?.code === queueIssue.code
        )
          ? { ...queueIssue, message: queueIssue.summary }
          : undefined
      }
      issues={{ ...currentQueueIssues, mode: undefined }}
      onCheck={onReload}
      onRecoverEdit={async (text, materials = [], recoveryKey) => {
        const recoveredDraft: ComposerDraft =
          recoveryKey && latestDraft.current.homeRecoveryKey === recoveryKey
            ? latestDraft.current
            : {
                ...latestDraft.current,
                homeRecoveryKey: recoveryKey,
                text: latestDraft.current.text
                  ? `${latestDraft.current.text}\n${text}`
                  : text,
                materials: [
                  ...latestDraft.current.materials,
                  ...materials.filter(
                    (material) =>
                      !latestDraft.current.materials.some(
                        (item) => item.id === material.id
                      )
                  ),
                ],
              }
        await (onRecoverDraft ?? onChange)(recoveredDraft)
        if (!mounted.current) return
        requestAnimationFrame(() => {
          inputRef.current?.focus()
          const length = inputRef.current?.value.length ?? 0
          inputRef.current?.setSelectionRange(length, length)
        })
      }}
      onEdit={queue.onEdit}
      onRemove={queue.onRemove}
      onSendNow={queue.onDeliver}
    />
  )
}
