import type { HomeSubmission } from "@/features/conversation/conversation-draft-store"

/** Same session is insufficient: a definitive refusal can be followed by a new attempt. */
export function sameHomeSubmissionAttempt(
  current: HomeSubmission | undefined,
  original: HomeSubmission
) {
  return (
    !!current &&
    (original.clientRequestId
      ? current.sessionId === original.sessionId &&
        current.clientRequestId === original.clientRequestId
      : current === original)
  )
}

/** Bounded, cancellable read-only observation. The caller supplies no send operation. */
export async function observeHomeReceipt(
  read: () => Promise<void>,
  ownsAttempt: () => boolean,
  signal: AbortSignal,
  pause: (ms: number, signal: AbortSignal) => Promise<void> = receiptPause
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted()
    if (!ownsAttempt()) return
    try {
      await read()
      return
    } catch (error) {
      signal.throwIfAborted()
      if (!ownsAttempt()) return
      if (attempt === 2) throw error
      await pause(attempt === 0 ? 400 : 1000, signal)
    }
  }
}
function receiptPause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancelled = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancelled)
      resolve()
    }, ms)
    signal.addEventListener("abort", cancelled, { once: true })
    if (signal.aborted) cancelled()
  })
}
