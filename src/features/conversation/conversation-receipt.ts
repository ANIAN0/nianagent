import type { ConversationService } from "./conversation-service"
import {
  inspectConversationReceipt,
  type ConversationReceipt,
} from "@/lib/submission/conversation-handoff"
export {
  inspectConversationReceipt,
  type ConversationReceipt,
} from "@/lib/submission/conversation-handoff"

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
