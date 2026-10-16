import { rpcCall } from "@/lib/rpc/client"
export async function callPlugin<T>(id: string, operation: string, input: object, sessionId?: string, signal?: AbortSignal): Promise<T> {
  const response = await rpcCall("pluginCall", { id, operation, payload: JSON.stringify(input), ...(sessionId ? { sessionId } : {}) }, signal)
  return JSON.parse(response.payload) as T
}
export const pluginsChanged = () => window.dispatchEvent(new Event("moon:plugins-changed"))
