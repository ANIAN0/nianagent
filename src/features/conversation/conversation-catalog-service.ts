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
    signal?: AbortSignal,
    expectedRunId?: string
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
    setArchived: (id, archived, signal, expectedRunId) =>
      rpcCall(
        "conversationSetArchived",
        { id, archived, expectedRunId },
        signal
      ),
  }
}
const defaultService = createConversationCatalogService()
const CATALOG_POLL_MS = 5_000
import type { HistoryState } from "@/lib/submission/conversation-handoff"
export type { HistoryState } from "@/lib/submission/conversation-handoff"

// One sequential poll keeps sidebar states current when another conversation is
// running. The selected conversation's body uses its own Pi snapshot lifecycle.
export function useConversationCatalog(
  service = defaultService,
  archived: "hide" | "all" | "only" = "hide"
) {
  const [snapshot, setSnapshot] = useState<{
    scope: typeof archived
    conversations: ConversationSummary[]
    historyState: HistoryState
    historyError: string
    historyIssue?: FeedbackDescription
  }>({
    scope: archived,
    conversations: [],
    historyState: "loading",
    historyError: "",
  })
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
          scope: archived,
          conversations:
            previous.scope === archived ? previous.conversations : [],
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
          const previousById = new Map(
            previous.conversations.map((item) => [item.id, item])
          )
          const merged = conversations.map((item) => {
            const existing = previousById.get(item.id)
            if (!existing) return item
            if (existing.revision > item.revision) return existing
            if (
              existing.revision === item.revision &&
              existing.pending?.approvals === item.pending?.approvals &&
              existing.pending?.answers === item.pending?.answers
            )
              return existing
            return item
          })
          // 内容无变化时保留数组引用，避免每轮轮询都触发下游整列重渲染。
          const unchanged =
            previous.conversations.length === merged.length &&
            merged.every(
              (item, index) => item === previous.conversations[index]
            )
          if (
            unchanged &&
            previous.scope === archived &&
            previous.historyState === "ready"
          )
            return previous
          return {
            scope: archived,
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
          scope: archived,
          conversations:
            previous.scope === archived ? previous.conversations : [],
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
    const inForeground = () => !document.hidden && document.hasFocus()
    const pause = () => clearTimeout(timer)
    const schedule = () => {
      pause()
      if (active && inForeground())
        timer = setTimeout(onResume, CATALOG_POLL_MS)
    }
    const onResume = () => {
      pause()
      if (active && inForeground()) void refresh(true).finally(schedule)
    }
    const onVisibilityChange = () => {
      if (inForeground()) onResume()
      else pause()
    }
    queueMicrotask(() => {
      if (active) void refresh(false).finally(schedule)
    })
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("focus", onResume)
    window.addEventListener("blur", pause)
    return () => {
      active = false
      pause()
      readRequest.current?.abort()
      writes.forEach((controller) => controller.abort())
      writes.clear()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onResume)
      window.removeEventListener("blur", pause)
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
    (id: string, archived: boolean, expectedRunId?: string) =>
      mutate((service, signal) =>
        service.setArchived(id, archived, signal, expectedRunId)
      ),
    [mutate]
  )
  const visible =
    snapshot.scope === archived
      ? snapshot
      : {
          conversations: [],
          historyState: "loading" as const,
          historyError: "",
          historyIssue: undefined,
        }
  return { ...visible, refresh, markRead, rename, setPinned, setArchived }
}

/** A stop acknowledgement can arrive before the Pi run publishes its terminal state. */
export async function waitForArchiveReady(
  sessionId: string,
  expectedRunId: string
) {
  const signal = AbortSignal.timeout(20_000)
  let stopRequested = false
  try {
    for (;;) {
      const current = await rpcCall(
        "conversationInfo",
        { id: sessionId },
        signal
      )
      if (!current || current.runId !== expectedRunId)
        throw new Error("会话运行已变化，请重新确认归档。")
      if (current.status !== "running" && current.status !== "stopping") {
        if (current.pending?.approvals || current.pending?.answers)
          throw new Error("会话仍有待处理请求，请处理后再归档。")
        return
      }
      if (current.status === "running" && !stopRequested) {
        stopRequested = true
        await rpcCall(
          "conversationStop",
          { sessionId, runId: expectedRunId },
          signal
        )
      }
      await new Promise((resolve) => window.setTimeout(resolve, 300))
    }
  } catch (error) {
    if (signal.aborted)
      throw new Error("尚未确认执行停止，请核对会话状态后重试归档。", {
        cause: error,
      })
    throw error
  }
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
    pending: item.pending,
    runId: item.runId,
  }
}
