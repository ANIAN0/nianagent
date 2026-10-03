import { modelCall } from "@/features/models/model-service"
import type { RpcRequests } from "@/features/models/model-contract.generated"

export function createConversationService() {
  return {
    read: (sessionId: string, signal?: AbortSignal) =>
      modelCall("conversationRead", { sessionId }, signal),
    send: (input: RpcRequests["conversationSend"], signal?: AbortSignal) =>
      modelCall("conversationSend", input, signal),
    stop: (sessionId: string, runId: string) =>
      modelCall("conversationStop", { sessionId, runId }),
    retry: (input: RpcRequests["conversationRetry"]) =>
      modelCall("conversationRetry", input),
  }
}
export type ConversationService = ReturnType<typeof createConversationService>
