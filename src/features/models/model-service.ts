import type {
  ModelOperation,
  RpcRequests,
  RpcResults,
} from "./model-contract.generated"
import { invoke, isTauri } from "@tauri-apps/api/core"
import type { ModelService } from "./model-types"
export async function modelCall<K extends ModelOperation>(
  operation: K,
  input: RpcRequests[K],
  signal?: AbortSignal
): Promise<RpcResults[K]> {
  signal?.throwIfAborted()
  if (isTauri()) {
    const requestId = crypto.randomUUID()
    const abort = () => {
      void invoke("cancel_model_request", { requestId }).catch(() => {})
    }
    signal?.addEventListener("abort", abort, { once: true })
    try {
      const result = await invoke<RpcResults[K]>("model_request", {
        requestId,
        operation,
        input,
      })
      signal?.throwIfAborted()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("Command model_request not found")) {
        throw new Error(
          "当前桌面程序版本过旧，缺少模型配置接口。请重新编译并重启 Moon；刷新页面或重新读取不能解决。",
          { cause: error }
        )
      }
      throw error instanceof Error ? error : new Error(message)
    } finally {
      signal?.removeEventListener("abort", abort)
    }
  }
  const response = await fetch(`/api/models/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  })
  const payload = await response.json()
  if (!response.ok || payload.error)
    throw new Error(payload.error || "模型后端不可用。")
  return payload.result as RpcResults[K]
}
export function createModelService(): ModelService {
  return {
    revealKey: (id, revision, signal) =>
      modelCall("revealKey", { id, revision }, signal),
    list: (signal) => modelCall("list", {}, signal),
    providers: (signal) => modelCall("providers", {}, signal),
    save: (connection, signal) =>
      modelCall(
        "save",
        {
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
    remove: async (id, signal, revision) => {
      if (revision === undefined) throw new Error("删除连接需要当前版本。")
      await modelCall("remove", { id, revision }, signal)
    },
    discover: (connection, signal) =>
      modelCall("discover", { connection }, signal),
    check: async (connection, model, signal) => {
      await modelCall("check", { connection, model }, signal)
    },
    authorize: async () => {
      throw new Error("请使用 Pi 授权流程。")
    },
    auth: {
      start: (connection, signal) =>
        modelCall("authStart", { connection }, signal),
      poll: (id, signal) => modelCall("authPoll", { id }, signal),
      reply: (id, promptId, value, signal) =>
        modelCall("authReply", { id, promptId, value }, signal),
      cancel: async (id) => {
        await modelCall("authCancel", { id })
      },
      logout: (id, signal) => modelCall("logout", { id }, signal),
    },
  }
}
