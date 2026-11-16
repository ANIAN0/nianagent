import { rpcCall } from "@/lib/rpc/client"
import { isTauri } from "@tauri-apps/api/core"
export async function callPlugin<T>(
  id: string,
  operation: string,
  input: object,
  sessionId?: string,
  signal?: AbortSignal,
  generation?: number
): Promise<T> {
  const response = await rpcCall(
    "pluginCall",
    {
      id,
      operation,
      payload: JSON.stringify(input),
      ...(sessionId ? { sessionId } : {}),
      ...(generation !== undefined ? { generation } : {}),
    },
    signal
  )
  return JSON.parse(response.payload) as T
}
export const pluginsChanged = () =>
  window.dispatchEvent(new Event("moon:plugins-changed"))
// 桌面端后端通知（插件包任务收尾等）即时刷新；远程/Web 由工作台轮询兜底。
if (isTauri())
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen("moon://plugins-state", () => {
      pluginsChanged()
    })
  )
