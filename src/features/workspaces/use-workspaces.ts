import { useCallback, useEffect, useRef, useState } from "react"
import type { Workspace } from "@/features/home/home-types"
import { createWorkspaceService } from "./workspace-service"

export function useWorkspaces() {
  const [service] = useState(createWorkspaceService)
  const [items, setItems] = useState<Workspace[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  const sequence = useRef(0)
  useEffect(() => {
    const request = ++sequence.current
    const controller = new AbortController()
    service
      .list(controller.signal)
      .then((result) => {
        if (controller.signal.aborted || request !== sequence.current) return
        setItems(result.items)
        setSelectedId(result.selectedId ?? undefined)
        setLoading(false)
        setError("")
      })
      .catch((failure) => {
        if (!controller.signal.aborted && request === sequence.current) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [service, version])
  const refresh = useCallback(() => setVersion((value) => value + 1), [])
  const adopt = (workspace: Workspace) => {
    ++sequence.current
    setLoading(false)
    setItems((previous) => [
      ...previous.filter((item) => item.id !== workspace.id),
      workspace,
    ])
    setSelectedId(workspace.id)
    setError("")
  }
  return {
    items,
    selectedId,
    loading,
    error,
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
