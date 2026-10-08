import type { ConversationSnapshot } from "@/contracts/rpc.generated"
import type { OperationIssue } from "@/contracts/rpc.generated"
import type { ConversationService } from "./conversation-service"

export type ConversationReceipt = {
  state: "accepted" | "handled" | "rejected" | "unknown"
  snapshot?: ConversationSnapshot
  clientRequestId?: string
  issue?: OperationIssue
}
/** Query the original request ledger first, including requests without a row. */
export async function readConversationReceipt(
  service: ConversationService,
  sessionId: string,
  clientRequestId: string | undefined,
  signal?: AbortSignal
): Promise<ConversationReceipt> {
  if (!clientRequestId)
    return inspectConversationReceipt(
      sessionId,
      clientRequestId,
      await service.read(sessionId, signal)
    )
  const lookup = await service.receipt(sessionId, clientRequestId, signal)
  signal?.throwIfAborted()
  if (
    lookup.sessionId !== sessionId ||
    lookup.clientRequestId !== clientRequestId
  )
    return { state: "unknown", clientRequestId }
  if (lookup.state !== "accepted" && lookup.state !== "handled")
    return {
      state: lookup.state,
      clientRequestId,
      ...(lookup.issue ? { issue: lookup.issue } : {}),
    }
  const snapshot = await service.read(sessionId, signal)
  signal?.throwIfAborted()
  if (snapshot.id !== sessionId) return { state: "unknown", clientRequestId }
  return { state: lookup.state, snapshot, clientRequestId }
}

/** A history read only confirms the original request; another turn is not proof. */
export function inspectConversationReceipt(
  sessionId: string,
  clientRequestId: string | undefined,
  snapshot: ConversationSnapshot
): ConversationReceipt {
  const receipt: ConversationReceipt = {
    state: "unknown",
    snapshot,
    clientRequestId,
  }
  if (snapshot.id !== sessionId || !clientRequestId) return receipt
  if (
    snapshot.queue?.acceptedRequestIds.includes(clientRequestId) ||
    (snapshot.clientRequestId === clientRequestId && snapshot.inputAccepted)
  )
    return { ...receipt, state: "accepted" }
  if (
    snapshot.clientRequestId === clientRequestId &&
    snapshot.inputDisposition === "handled"
  )
    return { ...receipt, state: "handled" }
  // A terminal run (including an older readable history) does not establish
  // rejection of this input. Only the explicit request ledger may do that.
  return receipt
}
