/**
 * Manager 与 preview iframe 之间的最小事件通道（借鉴 Storybook channels/postmessage）：
 * 命名事件、未就绪缓冲、preview 就绪握手。两端共用同一事件名表。
 */
export type ManagerToPreview =
  | "render-state"
  | "clear-selection"
export type PreviewToManager =
  | "ready"
  | "picked"
  | "pin-click"
  | "escape"

export type RenderStatePayload = {
  source: string
  /** meta.preview 指向的预览 bundle 条目；提供时优先于 source 渲染。 */
  preview: string
  args: Record<string, string | number | boolean | null>
  theme: "light" | "dark"
  mode: "browse" | "select"
  width: number | undefined
  comments: {
    id: string
    author: string
    resolved: boolean
    target: string
  }[]
}
export type PickedPayload = {
  selector: string
  text: string
  clientX: number
  clientY: number
}

type Send = (type: ManagerToPreview | PreviewToManager, payload?: unknown) => void

const post = (target: Window, origin: string, type: string, payload?: unknown) => {
  target.postMessage({ source: "moon-notes-channel", type, payload }, origin)
}

/** Manager 侧：监听 iframe 消息，ready 前缓冲出站事件。 */
export function attachManagerChannel(
  frame: Window,
  origin: string,
  handlers: {
    onReady?: () => void
    onPicked?: (payload: PickedPayload) => void
    onPinClick?: (commentId: string) => void
    onEscape?: () => void
  },
): { send: Send; dispose: () => void } {
  let ready = false
  const buffer: { type: string; payload?: unknown }[] = []
  const send: Send = (type, payload) => {
    if (!ready) {
      buffer.push({ type, payload })
      return
    }
    post(frame, origin, type, payload)
  }
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame || event.origin !== origin) return
    const data = event.data as
      | { source?: string; type?: string; payload?: unknown }
      | null
    if (!data || data.source !== "moon-notes-channel") return
    if (data.type === "ready") {
      ready = true
      handlers.onReady?.()
      for (const item of buffer) post(frame, origin, item.type, item.payload)
      buffer.length = 0
      return
    }
    if (data.type === "picked") handlers.onPicked?.(data.payload as PickedPayload)
    else if (data.type === "pin-click")
      handlers.onPinClick?.(String((data.payload as { commentId?: string })?.commentId ?? ""))
    else if (data.type === "escape") handlers.onEscape?.()
  }
  window.addEventListener("message", onMessage)
  return {
    send,
    dispose: () => window.removeEventListener("message", onMessage),
  }
}

/** Preview 侧：循环广播 ready 直至 manager 应答（收到任一 render-state 即视为连通）。 */
export function attachPreviewChannel(handlers: {
  onRenderState?: (payload: RenderStatePayload) => void
  onClearSelection?: () => void
}): { send: Send; dispose: () => void } {
  const target = window.parent
  const origin = window.location.origin
  let connected = false
  const announce = () => {
    post(target, origin, "ready")
  }
  announce()
  const timer = window.setInterval(announce, 250)
  const onMessage = (event: MessageEvent) => {
    if (event.source !== target || event.origin !== origin) return
    const data = event.data as
      | { source?: string; type?: string; payload?: unknown }
      | null
    if (!data || data.source !== "moon-notes-channel") return
    if (data.type === "render-state") {
      if (!connected) {
        connected = true
        window.clearInterval(timer)
      }
      handlers.onRenderState?.(data.payload as RenderStatePayload)
    } else if (data.type === "clear-selection") {
      handlers.onClearSelection?.()
    }
  }
  window.addEventListener("message", onMessage)
  return {
    send: (type, payload) => post(target, origin, type, payload),
    dispose: () => {
      window.clearInterval(timer)
      window.removeEventListener("message", onMessage)
    },
  }
}
