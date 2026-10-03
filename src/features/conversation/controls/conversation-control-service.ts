import { modelCall } from "@/features/models/model-service"
export function createConversationControlService() {
  return {
    compact: (sessionId: string, operationId: string, focus: string) =>
      modelCall("conversationCompact", { sessionId, operationId, focus }),
    read: (sessionId: string, operationId: string, signal?: AbortSignal) =>
      modelCall("conversationControlRead", { sessionId, operationId }, signal),
    cancel: (sessionId: string, operationId: string) =>
      modelCall("conversationCompactCancel", { sessionId, operationId }),
    fork: (sessionId: string, operationId: string, entryId: string) =>
      modelCall("conversationFork", { sessionId, operationId, entryId }),
  }
}
export type ConversationControlService = ReturnType<
  typeof createConversationControlService
>
