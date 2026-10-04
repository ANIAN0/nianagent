import type { ConversationSnapshot } from "@/features/models/model-contract.generated"

/** Only an authoritative receipt can reject a send; reconciliation itself is read-only. */
export async function reconcileHomeRequest(
  reconcile: () => Promise<ConversationSnapshot>,
  forgetRejected: () => void,
  cleanupFailed: () => void
): Promise<ConversationSnapshot> {
  const forget = () => {
    try {
      forgetRejected()
    } catch {
      cleanupFailed()
    }
  }
  // Failure to read says nothing about the original send's receipt.
  const snapshot = await reconcile()
  if (
    !snapshot.inputAccepted &&
    ["failed", "interrupted"].includes(snapshot.phase)
  )
    forget()
  return snapshot
}
