import { useCallback, useEffect, useRef, useState } from "react"
import { api, message } from "./api"
import { Canvas, type WidthMode } from "./canvas"
import { Comments } from "./comments"
import { Controls } from "./controls"
import { Tree } from "./tree"
import type { PageDetail, Snapshot } from "./types"

const POLL_MS = 2000

export function App() {
  const [tokenMissing] = useState(() => !api.hasToken())
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [detail, setDetail] = useState<PageDetail | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null)
  const [width, setWidth] = useState<WidthMode>("fit")
  const [panel, setPanel] = useState<"comments" | "controls">("comments")
  const [focusId, setFocusId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const selectedRef = useRef<string | null>(null)
  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])
  const bootVersionRef = useRef<number | null>(null)
  const loadPage = useCallback(async (pageId: string) => {
    try {
      const next = await api.page(pageId)
      setDetail(next)
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
  // 页面切换：默认选中首个状态（正常流程优先），清空焦点与视口记忆。
  const activePageId = activeDetail?.page.id ?? null
  const [previousPageId, setPreviousPageId] = useState<string | null>(null)
  if (activePageId !== previousPageId) {
    setPreviousPageId(activePageId)
    const states = activeDetail?.page.states ?? []
    setSelectedStateId(
      (states.find((state) => state.section === "normal") ?? states[0])?.id ??
        null,
    )
    setFocusId(null)
    // 换页回到该页设计视口；用户手动选过宽度则尊重当前选择。
    const viewport = activeDetail?.page.meta?.viewport
    setWidth(viewport ? viewport.width : "fit")
  }
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
    [loadPage, refresh],
  )
  const addReply = useCallback(
    async (parentId: string, text: string) => {
      const pageId = selectedRef.current
      if (!pageId || !text) return
      try {
        await api.addComment(pageId, "", text, parentId)
        await loadPage(pageId)
        await refresh()
      } catch (reason) {
        setError(message(reason))
      }
    },
    [loadPage, refresh],
  )
  const resolveComment = useCallback(
    async (commentId: string, resolved: boolean) => {
      const pageId = selectedRef.current
      try {
        await api.setCommentResolved(commentId, resolved)
        if (pageId) await loadPage(pageId)
        await refresh()
      } catch (reason) {
        setError(message(reason))
      }
    },
    [loadPage, refresh],
  )
  const changeArgs = useCallback(
    async (stateId: string, args: Record<string, string | number | boolean | null>) => {
      const pageId = selectedRef.current
      if (!pageId) return
      try {
        await api.setStateArgs(pageId, stateId, args)
        await loadPage(pageId)
      } catch (reason) {
        setError(message(reason))
      }
    },
    [loadPage],
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
    [loadPage, refresh],
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
          onSelect={(pageId) => {
            setSelectedId(pageId)
            // 选中页面立即加载详情，不等下一次轮询。
            if (pageId) void loadPage(pageId).catch(() => {})
          }}
          onChange={() => void afterTreeChange()}
          onError={setError}
        />
        <Canvas
          detail={activeDetail}
          width={width}
          onWidth={(mode) => {
            setWidth(mode)
          }}
          selectedStateId={selectedStateId}
          onSelectState={setSelectedStateId}
          onAddComment={addComment}
          onFocusComment={(commentId) => {
            setPanel("comments")
            setFocusId(commentId)
          }}
          onToggleStatus={toggleStatus}
          resourceVersion={snapshot?.resourceVersion ?? 0}
        />
        <div className="flex h-full w-80 shrink-0 flex-col border-l border-[#3c3c3c] bg-[#2c2c2c]">
          <div className="flex shrink-0 items-center gap-1 px-3 pt-2">
            {(["comments", "controls"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded px-2 py-1 text-[12px] transition-colors ${
                  panel === item
                    ? "bg-[#383838] font-medium text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
                onClick={() => setPanel(item)}
              >
                {item === "comments" ? "评论" : "属性"}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {panel === "comments" ? (
              <Comments
                detail={activeDetail}
                focusId={focusId}
                onAdd={addComment}
                onAddReply={addReply}
                onResolve={resolveComment}
              />
            ) : activeDetail ? (
              <Controls
                detail={activeDetail}
                state={
                  activeDetail.page.states.find(
                    (state) => state.id === selectedStateId,
                  ) ?? null
                }
                onArgsChange={(stateId, values) =>
                  void changeArgs(stateId, values)
                }
              />
            ) : (
              <p className="px-3 py-4 text-[11px] text-neutral-600">
                先选择一个页面。
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
