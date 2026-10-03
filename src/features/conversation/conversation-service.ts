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
    queueEdit: (input: RpcRequests["conversationQueueEdit"]) =>
      modelCall("conversationQueueEdit", input),
    queueRemove: (input: RpcRequests["conversationQueueRemove"]) =>
      modelCall("conversationQueueRemove", input),
    queueMode: (input: RpcRequests["conversationQueueMode"]) =>
      modelCall("conversationQueueMode", input),
    queueDeliver: (input: RpcRequests["conversationQueueDeliver"]) =>
      modelCall("conversationQueueDeliver", input),
  }
}
export type ConversationService = ReturnType<typeof createConversationService>
