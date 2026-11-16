import { useEffect, useRef, useState } from "react"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

export type UseConversationReadReceiptsOptions = {
  selected?: string
  currentRunId?: string
  currentPhase?: string
  metadataUnread?: boolean
  metadataRunId?: string
  metadataStatus?: string
  metadataRevision?: number
  settingsOpen: boolean
  markRead: (id: string, revision: number) => Promise<unknown>
}

export function useConversationReadReceipts({
  selected,
  currentRunId,
  currentPhase,
  metadataUnread,
  metadataRunId,
  metadataStatus,
  metadataRevision,
  settingsOpen,
  markRead,
}: UseConversationReadReceiptsOptions) {
  const [readReceiptIssues, setReadReceiptIssues] = useState<
    Record<string, FeedbackDescription | undefined>
  >({})
  const [readReceiptRetry, setReadReceiptRetry] = useState(0)
  const readReceiptAttempts = useRef(new Set<string>())
  const readReceiptLatest = useRef(new Map<string, string>())

  useEffect(() => {
    if (
      !selected ||
      !currentRunId ||
      !metadataUnread ||
      metadataRevision === undefined ||
      settingsOpen ||
      document.visibilityState === "hidden"
    )
      return
    if (
      metadataRunId !== currentRunId ||
      metadataStatus !==
        (currentPhase === "interrupted" ? "idle" : currentPhase)
    )
      return
    const identity = `${selected}:${currentRunId}:${metadataRevision}:${readReceiptRetry}`
    if (readReceiptAttempts.current.has(identity)) return
    readReceiptAttempts.current.add(identity)
    readReceiptLatest.current.set(selected, identity)
    void markRead(selected, metadataRevision)
      .then(() => {
        if (readReceiptLatest.current.get(selected) === identity)
          setReadReceiptIssues((all) => ({ ...all, [selected]: undefined }))
      })
      .catch((error) => {
        if (
          readReceiptLatest.current.get(selected) === identity &&
          !(error instanceof Error && error.name === "AbortError")
        )
          setReadReceiptIssues((all) => ({
            ...all,
            [selected]: feedbackFromError(
              error,
              "本次阅读状态未能保存，会话内容仍可使用。"
            ),
          }))
      })
  }, [
    selected,
    currentRunId,
    currentPhase,
    metadataUnread,
    metadataRunId,
    metadataStatus,
    metadataRevision,
    markRead,
    settingsOpen,
    readReceiptRetry,
  ])

  function retryReadReceipt() {
    setReadReceiptRetry((value) => value + 1)
  }

  return {
    issue: selected && metadataUnread ? readReceiptIssues[selected] : undefined,
    retry: retryReadReceipt,
  }
}
