import { rpcCall } from "@/lib/rpc/client"
import type { ModelService } from "./model-types"
export function createModelService(): ModelService {
  return {
    revealKey: (id, revision, signal) =>
      rpcCall("revealKey", { id, revision }, signal),
    list: (signal) => rpcCall("list", {}, signal),
    providers: (signal) => rpcCall("providers", {}, signal),
    save: (connection, signal, operationRequestId) =>
      rpcCall(
        "save",
        {
          ...(operationRequestId ? { operationRequestId } : {}),
          connection: {
            ...connection,
            clearKey:
              connection.credential === "key" &&
              !connection.keySaved &&
              !connection.apiKey,
          },
        },
        signal
      ),
    remove: async (id, signal, revision, operationRequestId) => {
      if (revision === undefined) throw new Error("删除连接需要当前版本。")
      await rpcCall(
        "remove",
        { id, revision, ...(operationRequestId ? { operationRequestId } : {}) },
        signal
      )
    },
    readWriteReceipt: (operation, operationRequestId, signal) =>
      rpcCall("writeReceiptRead", { operation, operationRequestId }, signal),
    discover: (connection, signal) =>
      rpcCall("discover", { connection }, signal),
    check: async (connection, model, signal) => {
      await rpcCall("check", { connection, model }, signal)
    },
    auth: {
      start: (connection, signal, operationRequestId) =>
        rpcCall(
          "authStart",
          { connection, ...(operationRequestId ? { operationRequestId } : {}) },
          signal
        ),
      poll: (id, signal) => rpcCall("authPoll", { id }, signal),
      reply: (id, promptId, value, signal) =>
        rpcCall("authReply", { id, promptId, value }, signal),
      cancel: async (id) => {
        await rpcCall("authCancel", { id })
      },
      logout: (id, signal) => rpcCall("logout", { id }, signal),
    },
  }
}
