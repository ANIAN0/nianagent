import { useCallback, useEffect, useRef, useState } from "react"
import { modelCall } from "@/features/models/model-service"
import type {
  ConversationSummary,
  ConversationFilter,
} from "@/features/models/model-contract.generated"
import type { Conversation } from "@/features/home/home-types"

export type ConversationCatalogService = {
  list: (
    filter?: ConversationFilter,
    signal?: AbortSignal
  ) => Promise<ConversationSummary[]>
  info: (
    id: string,
    signal?: AbortSignal
  ) => Promise<ConversationSummary | null>
  markRead: (
    id: string,
    revision: number,
    signal?: AbortSignal
  ) => Promise<ConversationSummary>
}
export function createConversationCatalogService(): ConversationCatalogService {
  return {
    list: (filter = {}, signal) =>
      modelCall("conversationList", { filter }, signal),
    info: (id, signal) => modelCall("conversationInfo", { id }, signal),
    markRead: (id, revision, signal) =>
      modelCall("conversationMarkRead", { id, revision }, signal),
  }
}
const defaultService = createConversationCatalogService()
export type HistoryState = "loading" | "ready" | "error"

// One sequential poll keeps sidebar states current when another conversation is
// running. The selected conversation's body uses its own Pi snapshot lifecycle.
export function useConversationCatalog(service = defaultService) {
  const [snapshot, setSnapshot] = useState<{
    conversations: ConversationSummary[]
    historyState: HistoryState
    historyError: string
  }>({ conversations: [], historyState: "loading", historyError: "" })
  const readRequest = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const readWrites = useRef(new Set<AbortController>())
  const refresh = useCallback(
    async (silent = false) => {
      const version = ++sequence.current
      readRequest.current?.abort()
      const controller = new AbortController()
      readRequest.current = controller
      if (!silent)
        setSnapshot((previous) => ({
          ...previous,
          historyState: "loading",
          historyError: "",
        }))
      try {
        const conversations = await service.list({}, controller.signal)
        if (controller.signal.aborted || version !== sequence.current) return
        setSnapshot((previous) => ({
          conversations: conversations.map((item) => {
            const existing = previous.conversations.find(
              (value) => value.id === item.id
            )
            return existing && existing.revision > item.revision
              ? existing
              : item
          }),
          historyState: "ready",
          historyError: "",
        }))
      } catch (error) {
        if (controller.signal.aborted || version !== sequence.current) return
        setSnapshot((previous) => ({
          ...previous,
          historyState: "error",
          historyError:
            error instanceof Error
              ? error.message
              : "无法读取会话列表，请重试。",
        }))
      }
    },
    [service]
  )
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const writes = readWrites.current
    async function poll() {
      await refresh(true)
      if (active) timer = setTimeout(poll, 2000)
    }
    void poll()
    const onFocus = () => {
      void refresh(true)
    }
    window.addEventListener("focus", onFocus)
    return () => {
      active = false
      clearTimeout(timer)
      readRequest.current?.abort()
      writes.forEach((controller) => controller.abort())
      writes.clear()
      window.removeEventListener("focus", onFocus)
    }
  }, [refresh])
  const markRead = useCallback(
    async (id: string, revision: number) => {
      const controller = new AbortController()
      readWrites.current.add(controller)
      try {
        const item = await service.markRead(id, revision, controller.signal)
        if (controller.signal.aborted) return
        setSnapshot((previous) => ({
          ...previous,
          conversations: previous.conversations.map((old) =>
            old.id === item.id && old.revision <= item.revision ? item : old
          ),
        }))
        return item
      } finally {
        readWrites.current.delete(controller)
      }
    },
    [service]
  )
  return { ...snapshot, refresh, markRead }
}

export function formatConversationAge(value: string, now = Date.now()) {
  const delta = Math.max(0, now - Date.parse(value))
  if (!Number.isFinite(delta)) return ""
  if (delta < 60000) return "刚刚"
  if (delta < 3600000) return `${Math.floor(delta / 60000)}分`
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}时`
  if (delta < 604800000) return `${Math.floor(delta / 86400000)}天`
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(value))
}
export function toHomeConversation(item: ConversationSummary): Conversation {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    title: item.title,
    status: item.status,
    unread: item.unread,
    revision: item.revision,
    cwd: item.cwd,
    updatedAt: item.updatedAt,
    updatedLabel: formatConversationAge(item.updatedAt),
    message: item.lastMessage,
  }
}
