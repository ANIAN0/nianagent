import { rpcCall } from "@/lib/rpc/client"
export function createConversationControlService() {
  return {
    compact: (sessionId: string, operationId: string, focus: string) =>
      rpcCall("conversationCompact", { sessionId, operationId, focus }),
    read: (sessionId: string, operationId: string, signal?: AbortSignal) =>
      rpcCall("conversationControlRead", { sessionId, operationId }, signal),
    cancel: (sessionId: string, operationId: string) =>
      rpcCall("conversationCompactCancel", { sessionId, operationId }),
    fork: (sessionId: string, operationId: string, entryId: string) =>
      rpcCall("conversationFork", { sessionId, operationId, entryId }),
  }
}
export type ConversationControlService = ReturnType<
  typeof createConversationControlService
>
