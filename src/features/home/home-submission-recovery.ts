import type { ConversationSnapshot } from "@/features/models/model-contract.generated"
import { RpcRequestRejected } from "@/features/models/model-service"

/** A definitive rejection unlocks resending; unknown or active requests retain their identity. */
export async function reconcileHomeRequest(
  reconcile: () => Promise<ConversationSnapshot>,
  forgetRejected: () => void,
  cleanupFailed: () => void,
  replayingSubmission = false
): Promise<ConversationSnapshot> {
  const forget = () => {
    try {
      forgetRejected()
    } catch {
      cleanupFailed()
    }
  }
  let snapshot: ConversationSnapshot
  try {
    snapshot = await reconcile()
  } catch (error) {
    // A rejected history read says nothing about the original send's receipt.
    if (replayingSubmission && error instanceof RpcRequestRejected) forget()
    throw error
  }
  if (
    !snapshot.inputAccepted &&
    ["failed", "interrupted"].includes(snapshot.phase)
  )
    forget()
  return snapshot
}
