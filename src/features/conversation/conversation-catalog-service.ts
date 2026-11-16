import { useCallback, useEffect, useRef, useState } from "react"
import { rpcCall } from "@/lib/rpc/client"
import type {
  ConversationSummary,
  ConversationFilter,
} from "@/contracts/rpc.generated"
import type { Conversation } from "@/lib/composer/types"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

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
  rename: (
    id: string,
    title: string,
    signal?: AbortSignal
  ) => Promise<ConversationSummary>
  setPinned: (
    id: string,
    pinned: boolean,
    signal?: AbortSignal
  ) => Promise<ConversationSummary>
  setArchived: (
    id: string,
    archived: boolean,
    signal?: AbortSignal
  ) => Promise<ConversationSummary>
}
export function createConversationCatalogService(): ConversationCatalogService {
  return {
    list: (filter = {}, signal) =>
      rpcCall("conversationList", { filter }, signal),
    info: (id, signal) => rpcCall("conversationInfo", { id }, signal),
    markRead: (id, revision, signal) =>
      rpcCall("conversationMarkRead", { id, revision }, signal),
    rename: (id, title, signal) =>
      rpcCall("conversationRename", { id, title }, signal),
    setPinned: (id, pinned, signal) =>
      rpcCall("conversationSetPinned", { id, pinned }, signal),
    setArchived: (id, archived, signal) =>
      rpcCall("conversationSetArchived", { id, archived }, signal),
  }
}
const defaultService = createConversationCatalogService()
import type { HistoryState } from "@/lib/submission/conversation-handoff"
export type { HistoryState } from "@/lib/submission/conversation-handoff"

// One sequential poll keeps sidebar states current when another conversation is
// running. The selected conversation's body uses its own Pi snapshot lifecycle.
export function useConversationCatalog(
  service = defaultService,
  archived: "hide" | "all" | "only" = "hide"
) {
  const [snapshot, setSnapshot] = useState<{
    conversations: ConversationSummary[]
    historyState: HistoryState
    historyError: string
    historyIssue?: FeedbackDescription
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
          historyIssue: undefined,
        }))
      try {
        const conversations = await service.list(
          archived === "hide" ? {} : { archived },
          controller.signal
        )
        if (controller.signal.aborted || version !== sequence.current) return
        setSnapshot((previous) => {
          const merged = conversations.map((item) => {
            const existing = previous.conversations.find(
              (value) => value.id === item.id
            )
            return existing && existing.revision > item.revision
              ? existing
              : item
          })
          // 内容无变化时保留数组引用，避免每轮轮询都触发下游整列重渲染。
          const unchanged =
            previous.conversations.length === merged.length &&
            merged.every(
              (item, index) => item === previous.conversations[index]
            )
          return {
            conversations: unchanged ? previous.conversations : merged,
            historyState: "ready",
            historyError: "",
            historyIssue: undefined,
          }
        })
      } catch (error) {
        if (controller.signal.aborted || version !== sequence.current) return
        const feedback = feedbackFromError(
          error,
          "会话列表暂时无法读取，请重新读取。"
        )
        setSnapshot((previous) => ({
          ...previous,
          historyState: "error",
          historyError: feedback.message,
          historyIssue:
            feedback.code === "cancelled"
              ? { ...feedback, recovery: "reload" }
              : feedback,
        }))
      }
    },
    [service, archived]
  )
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const writes = readWrites.current
    async function poll() {
      // 页面隐藏时跳过读取，回到前台立即补一轮。
      if (!document.hidden) await refresh(true)
      if (active) timer = setTimeout(poll, 2000)
    }
    void poll()
    const onFocus = () => {
      void refresh(true)
    }
    const onVisibilityChange = () => {
      if (!document.hidden) void refresh(true)
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("focus", onFocus)
    return () => {
      active = false
      clearTimeout(timer)
      readRequest.current?.abort()
      writes.forEach((controller) => controller.abort())
      writes.clear()
      document.removeEventListener("visibilitychange", onVisibilityChange)
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
  // 列表动作共用同一合并语义：revision 较新的结果覆盖旧条目。
  const mutate = useCallback(
    async (
      operation: (
        service: ConversationCatalogService,
        signal: AbortSignal
      ) => Promise<ConversationSummary>
    ) => {
      const controller = new AbortController()
      readWrites.current.add(controller)
      try {
        const item = await operation(service, controller.signal)
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
  const rename = useCallback(
    (id: string, title: string) =>
      mutate((service, signal) => service.rename(id, title, signal)),
    [mutate]
  )
  const setPinned = useCallback(
    (id: string, pinned: boolean) =>
      mutate((service, signal) => service.setPinned(id, pinned, signal)),
    [mutate]
  )
  const setArchived = useCallback(
    (id: string, archived: boolean) =>
      mutate((service, signal) => service.setArchived(id, archived, signal)),
    [mutate]
  )
  return { ...snapshot, refresh, markRead, rename, setPinned, setArchived }
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
    pinned: item.pinned,
    archived: item.archived,
  }
}
