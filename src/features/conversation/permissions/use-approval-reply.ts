import { useCallback, useSyncExternalStore } from "react"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

type ApprovalReply = {
  phase: "idle" | "sending" | "submitted" | "uncertain"
  answer?: string
  issue?: FeedbackDescription
  expiresAt?: number
}
const idle: ApprovalReply = { phase: "idle" }
// Like DSH's PendingApproval, one decision belongs to the request rather than
// the mounted card. Switching conversations cannot unlock a pending decision.
const replies = new Map<string, ApprovalReply>()
const listeners = new Map<string, Set<() => void>>()
function publish(key: string, value: ApprovalReply) {
  replies.set(key, value)
  listeners.get(key)?.forEach((listener) => listener())
}

export function useApprovalReply(
  key: string,
  expiresAt: number,
  onReply: (answer: string) => Promise<unknown>
) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const owned = listeners.get(key) ?? new Set<() => void>()
      listeners.set(key, owned)
      owned.add(listener)
      return () => {
        owned.delete(listener)
        if (!owned.size) listeners.delete(key)
      }
    },
    [key]
  )
  const getSnapshot = useCallback(() => replies.get(key) ?? idle, [key])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  async function reply(answer: string) {
    if (
      (replies.get(key)?.phase ?? "idle") !== "idle" ||
      Date.now() >= expiresAt
    )
      return
    for (const [oldKey, old] of replies)
      if (
        old.phase !== "sending" &&
        old.expiresAt !== undefined &&
        old.expiresAt <= Date.now()
      )
        replies.delete(oldKey)
    publish(key, { phase: "sending", answer, expiresAt })
    try {
      await onReply(answer)
      publish(key, { phase: "submitted", answer, expiresAt })
    } catch (error) {
      const issue = feedbackFromError(error)
      const uncertain =
        ["result_unknown", "result_pending"].includes(issue.code) ||
        ["check", "reload", "restart"].includes(issue.recovery ?? "none")
      publish(key, {
        phase: uncertain ? "uncertain" : "idle",
        answer,
        expiresAt,
        issue,
      })
    }
  }
  return { ...state, reply }
}
