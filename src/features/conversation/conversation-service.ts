import { rpcCall } from "@/lib/rpc/client"
import type {
  RpcRequests,
  ConversationSnapshot,
} from "@/contracts/rpc.generated"

export function createConversationService() {
  return {
    queueReceipt: (
      sessionId: string,
      operationRequestId: string,
      signal?: AbortSignal
    ) =>
      rpcCall(
        "conversationQueueReceiptRead",
        { sessionId, operationRequestId },
        signal
      ),
    receipt: (
      sessionId: string,
      clientRequestId: string,
      signal?: AbortSignal
    ) =>
      rpcCall(
        "conversationReceiptRead",
        { sessionId, clientRequestId },
        signal
      ),
    read: (sessionId: string, signal?: AbortSignal) =>
      rpcCall("conversationRead", { sessionId }, signal),
    follow: async (
      sessionId: string,
      previous?: ConversationSnapshot,
      signal?: AbortSignal
    ) => {
      const frame = await rpcCall(
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
      return rpcCall("conversationRead", { sessionId }, signal)
    },
    send: (input: RpcRequests["conversationSend"], signal?: AbortSignal) =>
      rpcCall("conversationSend", input, signal),
    stop: (sessionId: string, runId: string) =>
      rpcCall("conversationStop", { sessionId, runId }),
    retry: (input: RpcRequests["conversationRetry"]) =>
      rpcCall("conversationRetry", input),
    queueEdit: (input: RpcRequests["conversationQueueEdit"]) =>
      rpcCall("conversationQueueEdit", input),
    queueRemove: (input: RpcRequests["conversationQueueRemove"]) =>
      rpcCall("conversationQueueRemove", input),
    queueMode: (input: RpcRequests["conversationQueueMode"]) =>
      rpcCall("conversationQueueMode", input),
    queueDeliver: (input: RpcRequests["conversationQueueDeliver"]) =>
      rpcCall("conversationQueueDeliver", input),
  }
}
export type ConversationService = ReturnType<typeof createConversationService>
