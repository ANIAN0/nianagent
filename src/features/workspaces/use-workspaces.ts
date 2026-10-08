import { useCallback, useEffect, useRef, useState } from "react"
import type { Workspace } from "@/lib/composer/types"
import { createWorkspaceService } from "./workspace-service"
import { createWorkspaceReadController } from "./workspace-read-controller"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

export function useWorkspaces() {
  const [service] = useState(createWorkspaceService)
  const [items, setItems] = useState<Workspace[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState("")
  const [issue, setIssue] = useState<FeedbackDescription>()
  const mounted = useRef(true)
  const [reader] = useState(() =>
    createWorkspaceReadController((signal) => service.list(signal), {
      onPending: setLoading,
      onSuccess: (result) => {
        setInitialized(true)
        setItems(result.items)
        setSelectedId(result.selectedId ?? undefined)
        setError("")
        setIssue(undefined)
      },
      onError: (failure) => {
        setInitialized(true)
        const feedback = feedbackFromError(
          failure,
          "工作目录列表未能读取，请重新读取。"
        )
        setError(feedback.message)
        setIssue(
          feedback.code === "cancelled"
            ? { ...feedback, recovery: "reload" }
            : feedback
        )
      },
    })
  )
  const refresh = useCallback(
    (signal?: AbortSignal): Promise<void> => {
      if (!mounted.current)
        return Promise.reject(new DOMException("页面已关闭。", "AbortError"))
      return reader.read(signal)
    },
    [reader]
  )
  useEffect(() => {
    mounted.current = true
    // Initial reads report through issue; imperative recovery callers receive
    // the same failure instead of resolving before a request even starts.
    void refresh().catch(() => {})
    return () => {
      mounted.current = false
      reader.cancel()
    }
  }, [reader, refresh])
  const adopt = (workspace: Workspace) => {
    if (!mounted.current) return
    reader.cancel()
    setLoading(false)
    setInitialized(true)
    setItems((previous) => [
      ...previous.filter((item) => item.id !== workspace.id),
      workspace,
    ])
    setSelectedId(workspace.id)
    setError("")
    setIssue(undefined)
  }
  return {
    items,
    selectedId,
    loading,
    initialized,
    initialLoading: !initialized,
    error,
    issue,
    refresh,
    select: async (id: string, signal?: AbortSignal) => {
      const workspace = await service.select(id, signal)
      signal?.throwIfAborted()
      adopt(workspace)
    },
    choose: async (signal?: AbortSignal) => {
      const workspace = await service.choose(signal)
      signal?.throwIfAborted()
      if (workspace) adopt(workspace)
      return workspace
    },
  }
}
