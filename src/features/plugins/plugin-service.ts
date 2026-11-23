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
export type PluginHostEvent = {
  type: "plugin-event"
  pluginId: string
  event: string
  payload?: unknown
}
export const pluginsChanged = () =>
  window.dispatchEvent(new Event("moon:plugins-changed"))
export function subscribePluginEvent(
  pluginId: string,
  event: string,
  listener: (payload: unknown) => void
) {
  const handler = (raw: Event) => {
    const detail = (raw as CustomEvent<PluginHostEvent>).detail
    if (
      detail &&
      detail.type === "plugin-event" &&
      detail.pluginId === pluginId &&
      detail.event === event
    )
      listener(detail.payload)
  }
  window.addEventListener("moon:plugin-event", handler)
  return () => window.removeEventListener("moon:plugin-event", handler)
}
// 桌面端后端通知（插件包任务收尾与插件实时事件）即时转发；远程/Web 由各自轮询兜底。
if (isTauri())
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen<unknown>("moon://plugins-state", (message) => {
      const payload = message.payload
      if (
        payload &&
        typeof payload === "object" &&
        (payload as PluginHostEvent).type === "plugin-event"
      ) {
        window.dispatchEvent(
          new CustomEvent("moon:plugin-event", { detail: payload })
        )
        return
      }
      pluginsChanged()
    })
  )
