import { useCallback, useEffect, useRef, useState } from "react"
import { api, message } from "./api"
import { Canvas, type WidthMode } from "./canvas"
import { Comments } from "./comments"
import { Tree } from "./tree"
import type { PageDetail, Snapshot } from "./types"

const POLL_MS = 2000

export function App() {
  const [tokenMissing] = useState(() => !api.hasToken())
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [detail, setDetail] = useState<PageDetail | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [width, setWidth] = useState<WidthMode>("fit")
  const [focusId, setFocusId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const selectedRef = useRef<string | null>(null)
  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])
  const bootVersionRef = useRef<number | null>(null)
  const loadPage = useCallback(async (pageId: string) => {
    try {
      setDetail(await api.page(pageId))
      setError("")
    } catch (reason) {
      setDetail(null)
      setError(message(reason))
    }
  }, [])
  const refresh = useCallback(async () => {
    try {
      const next = await api.state()
      // 详情页重载页面资源后版本变化，整页刷新取新工作台。
      if (typeof next.resourceVersion === "number") {
        if (bootVersionRef.current === null)
          bootVersionRef.current = next.resourceVersion
        else if (bootVersionRef.current !== next.resourceVersion) {
          window.location.reload()
          return
        }
      }
      setSnapshot(next)
      setError("")
    } catch (reason) {
      setError(message(reason))
    }
  }, [])
  useEffect(() => {
    if (tokenMissing) return
    let alive = true
    const tick = async () => {
      await refresh()
      const pageId = selectedRef.current
      if (pageId && alive) await loadPage(pageId)
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh, loadPage, tokenMissing])
  const activeDetail =
    selectedId && detail && detail.page.id === selectedId ? detail : null
  const addComment = useCallback(
    async (target: string, text: string) => {
      const pageId = selectedRef.current
      if (!pageId || !text) return
      try {
        await api.addComment(pageId, target, text)
        await loadPage(pageId)
        await refresh()
      } catch (reason) {
        setError(message(reason))
      }
    },
    [loadPage, refresh]
  )
  const afterTreeChange = useCallback(async () => {
    await refresh()
  }, [refresh])
  const toggleStatus = useCallback(
    async (status: "draft" | "confirmed") => {
      const pageId = selectedRef.current
      if (!pageId) return
      try {
        await api.setPageStatus(pageId, status)
        await loadPage(pageId)
        await refresh()
      } catch (reason) {
        setError(message(reason))
      }
    },
    [loadPage, refresh]
  )
  if (tokenMissing)
    return (
      <div className="flex h-screen items-center justify-center bg-[#1e1e1e] text-sm text-neutral-500">
        缺少访问 token：请从 Moon 插件详情页的「打开工作台」进入。
      </div>
    )
  return (
    <div className="flex h-screen flex-col bg-[#1e1e1e] text-neutral-200">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[#3c3c3c] bg-[#2c2c2c] px-4">
        <span className="text-[13px] font-medium text-neutral-200">
          笔记工作台
        </span>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </header>
      <main className="flex min-h-0 flex-1">
        <Tree
          snapshot={snapshot}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={() => void afterTreeChange()}
          onError={setError}
        />
        <Canvas
          detail={activeDetail}
          width={width}
          onWidth={setWidth}
          onAddComment={addComment}
          onFocusComment={(commentId) => setFocusId(commentId)}
          onToggleStatus={toggleStatus}
        />
        <Comments
          detail={activeDetail}
          focusId={focusId}
          onAdd={addComment}
        />
      </main>
    </div>
  )
}
