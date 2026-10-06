import { modelCall } from "@/features/models/model-service"
import type {
  RpcRequests,
  ConversationSnapshot,
} from "@/features/models/model-contract.generated"

export function createConversationService() {
  return {
    queueReceipt: (
      sessionId: string,
      operationRequestId: string,
      signal?: AbortSignal
    ) =>
      modelCall(
        "conversationQueueReceiptRead",
        { sessionId, operationRequestId },
        signal
      ),
    receipt: (
      sessionId: string,
      clientRequestId: string,
      signal?: AbortSignal
    ) =>
      modelCall(
        "conversationReceiptRead",
        { sessionId, clientRequestId },
        signal
      ),
    read: (sessionId: string, signal?: AbortSignal) =>
      modelCall("conversationRead", { sessionId }, signal),
    follow: async (
      sessionId: string,
      previous?: ConversationSnapshot,
      signal?: AbortSignal
    ) => {
      const frame = await modelCall(
        "conversationFollow",
        {
          sessionId,
          ...(previous
            ? { epoch: previous.epoch, afterVersion: previous.version }
            : {}),
        },
        signal
      )
      if (frame.kind === "heartbeat") return previous!
      if (frame.kind === "snapshot" && frame.snapshot) return frame.snapshot
      if (
        previous &&
        frame.epoch === previous.epoch &&
        frame.baseVersion === previous.version &&
        frame.metadata &&
        frame.order &&
        frame.upserts
      ) {
        const messages = new Map(
          previous.messages.map((message) => [message.id, message])
        )
        frame.upserts.forEach((message) => messages.set(message.id, message))
        if (frame.order.every((id) => messages.has(id)))
          return {
            ...frame.metadata,
            messages: frame.order.map((id) => messages.get(id)!),
          }
      }
      return modelCall("conversationRead", { sessionId }, signal)
    },
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
