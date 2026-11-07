import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { api, message } from "./api"
import { Canvas, type OperationInfo, type WidthMode } from "./canvas"
import { Comments } from "./comments"
import { HOST_CHANNEL } from "./channel"
import { Controls } from "./controls"
import { NoticeBar, WorkbenchErrorBoundary, type Notice } from "./error"
import { Help } from "./help"
import { isTypingTarget } from "./shortcuts"
import { useShellTheme } from "./theme"
import { Tree } from "./tree"
import type { ArgValue, PageDetail, Snapshot } from "./types"
import {
  applyHash,
  parseHash,
  type PanelMode,
  type ViewMode,
} from "./url-state"

const LAYOUT_KEY = "moon-notes-workbench-layout"
const readLayout = () => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}")
    if (!value || typeof value !== "object") return {}
    const record = value as { collapsed?: unknown; panelWidth?: unknown }
    return {
      collapsed: record.collapsed === true,
      panelWidth:
        typeof record.panelWidth === "number" &&
        record.panelWidth >= 240 &&
        record.panelWidth <= 560
          ? record.panelWidth
          : undefined,
    }
  } catch {
    return {}
  }
}

function App() {
  const boot = useMemo(() => parseHash(window.location.hash), [])
  const [tokenMissing] = useState(() => !api.hasToken())
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [detail, setDetail] = useState<PageDetail | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(boot.pageId)
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null)
  const [width, setWidth] = useState<WidthMode>(boot.width ?? "fit")
  const [height, setHeight] = useState<number | null>(boot.height)
  const [view, setView] = useState<ViewMode>(boot.view)
  const [panel, setPanel] = useState<PanelMode>(boot.panel)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [health, setHealth] = useState("")
  const [operations, setOperations] = useState<Map<
    string,
    OperationInfo
  > | null>(null)
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<boolean>(
    () => readLayout().collapsed === true
  )
  const [panelWidth, setPanelWidth] = useState(
    () => readLayout().panelWidth ?? 320
  )
  const [zen, setZen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [shellTheme, setShellTheme] = useShellTheme()

  const noticeSeq = useRef(0)
  const pushNotice = useCallback((kind: Notice["kind"], text: string) => {
    setNotices((list) => {
      const rest = list.filter(
        (notice) => !(notice.kind === kind && notice.text === text)
      )
      return [...rest, { id: (noticeSeq.current += 1), kind, text }]
    })
  }, [])
  const dismissNotice = useCallback(
    (id: number) =>
      setNotices((list) => list.filter((notice) => notice.id !== id)),
    []
  )
  const clearErrors = useCallback(
    () =>
      setNotices((list) => list.filter((notice) => notice.kind !== "error")),
    []
  )
  const fail = useCallback(
    (text: string) => pushNotice("error", text),
    [pushNotice]
  )

  const selectedRef = useRef<string | null>(null)
  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])
  const bootVersionRef = useRef<number | null>(null)
  const dataVersionRef = useRef(0)
  const loadPage = useCallback(
    async (pageId: string) => {
      try {
        const next = await api.page(pageId)
        setDetail(next)
      } catch (reason) {
        setDetail(null)
        fail(message(reason))
      }
    },
    [fail]
  )
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
      if (typeof next.dataVersion === "number")
        dataVersionRef.current = next.dataVersion
      setSnapshot(next)
      setHealth(next.health?.reason ?? "")
      clearErrors()
    } catch (reason) {
      fail(message(reason))
    }
  }, [clearErrors, fail])

  // 长轮询同步：版本变化即刷新；断线退避 3 秒重试，替代固定间隔轮询。
  useEffect(() => {
    if (tokenMissing) return
    let alive = true
    const tick = async () => {
      await refresh()
      const pageId = selectedRef.current
      if (pageId && alive) await loadPage(pageId)
    }
    const loop = async () => {
      await tick()
      while (alive) {
        try {
          const result = await api.sync(dataVersionRef.current)
          dataVersionRef.current = result.version
          if (!alive) return
          await tick()
        } catch (reason) {
          if (!alive) return
          fail(message(reason))
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
      }
    }
    void loop()
    return () => {
      alive = false
    }
  }, [refresh, loadPage, fail, tokenMissing])
  useEffect(() => {
    if (tokenMissing) return
    let alive = true
    void api
      .operations()
      .then((value) => {
        if (!alive) return
        setOperations(new Map(Object.entries(value.operations)))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [tokenMissing])

  const activeDetail =
    selectedId && detail && detail.page.id === selectedId ? detail : null
  // 页面切换：默认选中首个状态（正常流程优先），清空焦点；换页回到该页设计视口。
  // 渲染期按「上一页 id」调整派生状态，避免 effect 级联渲染。
  const activePageId = activeDetail?.page.id ?? null
  const [previousPageId, setPreviousPageId] = useState<string | null>(null)
  if (activePageId !== previousPageId) {
    setPreviousPageId(activePageId)
    const states = activeDetail?.page.states ?? []
    setSelectedStateId(
      (states.find((state) => state.section === "normal") ?? states[0])?.id ??
        null
    )
    setFocusId(null)
    if (activeDetail && typeof width !== "number") {
      const viewport = activeDetail.page.meta?.viewport
      setWidth(viewport ? viewport.width : "fit")
    }
  }

  const selectPage = useCallback(
    (pageId: string) => {
      setSelectedId(pageId || null)
      if (pageId) void loadPage(pageId)
      else setDetail(null)
    },
    [loadPage]
  )

  // 地址 hash 即状态：本页变更用 replaceState 回写；外部深链经 hashchange 应用。
  useEffect(() => {
    applyHash({
      pageId: selectedId,
      view,
      panel,
      stateId: selectedStateId,
      width: typeof width === "number" ? width : null,
      height,
    })
  }, [selectedId, view, panel, selectedStateId, width, height])
  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash(window.location.hash)
      setSelectedId(parsed.pageId)
      setView(parsed.view)
      setPanel(parsed.panel)
      setWidth(parsed.width ?? "fit")
      setHeight(parsed.height)
      if (parsed.pageId) void loadPage(parsed.pageId)
      else setDetail(null)
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [loadPage])
  // 内嵌于宿主时上报当前页面，宿主据此同步深链与「浏览器打开」；独立打开时没有父窗口。
  useEffect(() => {
    if (window.parent === window) return
    window.parent.postMessage(
      { source: HOST_CHANNEL, type: "page-changed", pageId: selectedId },
      "*"
    )
  }, [selectedId])

  const afterChange = useCallback(async () => {
    await refresh()
    const pageId = selectedRef.current
    if (pageId) await loadPage(pageId)
  }, [refresh, loadPage])
  const addComment = useCallback(
    async (target: string, text: string) => {
      const pageId = selectedRef.current
      if (!pageId || !text) return
      try {
        await api.addComment(pageId, target, text)
        await loadPage(pageId)
        await refresh()
      } catch (reason) {
        fail(message(reason))
      }
    },
    [loadPage, refresh, fail]
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
        fail(message(reason))
      }
    },
    [loadPage, refresh, fail]
  )
  const resolveComment = useCallback(
    async (commentId: string, resolved: boolean) => {
      const pageId = selectedRef.current
      try {
        await api.setCommentResolved(commentId, resolved)
        if (pageId) await loadPage(pageId)
        await refresh()
      } catch (reason) {
        fail(message(reason))
      }
    },
    [loadPage, refresh, fail]
  )
  const changeArgs = useCallback(
    async (stateId: string, args: Record<string, ArgValue>) => {
      const pageId = selectedRef.current
      if (!pageId) return
      try {
        await api.setStateArgs(pageId, stateId, args)
        await loadPage(pageId)
      } catch (reason) {
        fail(message(reason))
      }
    },
    [loadPage, fail]
  )
  const toggleStatus = useCallback(
    async (status: "draft" | "confirmed") => {
      const pageId = selectedRef.current
      if (!pageId) return
      try {
        await api.setPageStatus(pageId, status)
        await loadPage(pageId)
        await refresh()
      } catch (reason) {
        fail(message(reason))
      }
    },
    [loadPage, refresh, fail]
  )

  // 搜索过滤：标题与页面名匹配；空目录在搜索时隐藏。
  const filteredSnapshot = useMemo(() => {
    if (!snapshot) return null
    const keyword = query.trim().toLowerCase()
    if (!keyword) return snapshot
    const pages = snapshot.pages.filter(
      (page) =>
        (page.title || page.name).toLowerCase().includes(keyword) ||
        page.name.toLowerCase().includes(keyword)
    )
    const directoryIds = new Set(pages.map((page) => page.directoryId))
    return {
      ...snapshot,
      pages,
      directories: snapshot.directories.filter((directory) =>
        directoryIds.has(directory.id)
      ),
    }
  }, [snapshot, query])
  const orderedPageIds = useMemo(
    () => (filteredSnapshot?.pages ?? []).map((page) => page.id),
    [filteredSnapshot]
  )
  const stepPage = useCallback(
    (delta: number) => {
      const pages = orderedPageIds
      if (!pages.length) return
      const index = selectedId ? pages.indexOf(selectedId) : -1
      const nextId =
        pages[
          index === -1
            ? delta > 0
              ? 0
              : pages.length - 1
            : Math.min(pages.length - 1, Math.max(0, index + delta))
        ]
      if (nextId && nextId !== selectedId) selectPage(nextId)
    },
    [orderedPageIds, selectedId, selectPage]
  )

  // 全局快捷键；输入场景放行，组合键只保留 Ctrl/Cmd+B 折叠目录。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault()
        setCollapsed((value) => !value)
        return
      }
      if (isTypingTarget(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      switch (event.key) {
        case "/":
          event.preventDefault()
          document.getElementById("page-search")?.focus()
          break
        case "ArrowDown":
          event.preventDefault()
          stepPage(1)
          break
        case "ArrowUp":
          event.preventDefault()
          stepPage(-1)
          break
        case "1":
          setView("canvas")
          break
        case "2":
          setView("docs")
          break
        case "3":
          setPanel((value) => (value === "comments" ? "controls" : "comments"))
          break
        case "f":
        case "F":
          setZen((value) => !value)
          break
        case "?":
          setHelpOpen((value) => !value)
          break
        case "Escape":
          if (helpOpen) setHelpOpen(false)
          else setZen(false)
          break
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [stepPage, helpOpen])

  useEffect(() => {
    try {
      localStorage.setItem(
        LAYOUT_KEY,
        JSON.stringify({ collapsed, panelWidth })
      )
    } catch {
      /* 存储不可用时布局不持久化。 */
    }
  }, [collapsed, panelWidth])
  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelWidth
    const move = (moveEvent: PointerEvent) =>
      setPanelWidth(
        Math.min(560, Math.max(240, startWidth - (moveEvent.clientX - startX)))
      )
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  if (tokenMissing)
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)] text-sm text-[var(--text-muted)]">
        缺少访问 token：请从 Moon 插件详情页的「打开工作台」进入。
      </div>
    )
  return (
    <div className="relative flex h-screen flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-4">
        <span className="text-[13px] font-medium text-[var(--text)]">
          笔记工作台
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={zen ? "退出聚焦" : "聚焦画布"}
          title={zen ? "退出聚焦（Esc）" : "聚焦画布（F）"}
          className={`rounded p-1 text-[13px] transition-colors ${
            zen
              ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
              : "text-[var(--text-muted)] hover:bg-[var(--raised)] hover:text-[var(--text-2)]"
          }`}
          onClick={() => setZen((value) => !value)}
        >
          ⛶
        </button>
        <button
          type="button"
          aria-label={shellTheme === "dark" ? "切换浅色" : "切换深色"}
          title={shellTheme === "dark" ? "切换浅色壳" : "切换深色壳"}
          className="rounded p-1 text-[13px] text-[var(--text-muted)] transition-colors hover:bg-[var(--raised)] hover:text-[var(--text-2)]"
          onClick={() =>
            setShellTheme(shellTheme === "dark" ? "light" : "dark")
          }
        >
          ◐
        </button>
        <button
          type="button"
          aria-label="快捷键帮助"
          title="快捷键（?）"
          className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-2)]"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>
      </header>
      {health && (
        <div className="flex items-start gap-2 border-b border-[var(--warning-border)] bg-[var(--warning-soft)] px-4 py-1.5 text-[12px] leading-5 text-[var(--warning)]">
          <span className="min-w-0 flex-1">{health}</span>
          <button
            type="button"
            aria-label="关闭数据提示"
            className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
            onClick={() => setHealth("")}
          >
            ✕
          </button>
        </div>
      )}
      <NoticeBar notices={notices} onDismiss={dismissNotice} />
      <main className="flex min-h-0 flex-1">
        {!zen && (
          <Tree
            snapshot={filteredSnapshot}
            selectedId={selectedId}
            query={query}
            onQuery={setQuery}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((value) => !value)}
            onSelect={selectPage}
            onChange={() => void afterChange()}
            onError={fail}
          />
        )}
        <Canvas
          detail={activeDetail}
          width={width}
          height={height}
          zoom={zoom}
          onWidth={setWidth}
          onHeight={setHeight}
          onZoom={setZoom}
          selectedStateId={selectedStateId}
          onSelectState={setSelectedStateId}
          onAddComment={addComment}
          onFocusComment={(commentId) => {
            setPanel("comments")
            setFocusId(commentId)
          }}
          onToggleStatus={toggleStatus}
          onToggleZen={() => setZen((value) => !value)}
          onPageSaved={() => void afterChange()}
          onError={fail}
          resourceVersion={snapshot?.resourceVersion ?? 0}
          operations={operations}
        />
        {!zen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="拖拽调整面板宽度"
              className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent-soft)]"
              onPointerDown={startResize}
            />
            <div
              className="flex h-full shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel)]"
              style={{ width: panelWidth }}
            >
              <div className="flex shrink-0 items-center gap-1 px-3 pt-2">
                {(["comments", "controls"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`rounded px-2 py-1 text-[12px] transition-colors ${
                      panel === item
                        ? "bg-[var(--raised)] font-medium text-[var(--text-strong)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-2)]"
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
                        (state) => state.id === selectedStateId
                      ) ?? null
                    }
                    onArgsChange={(stateId, values) =>
                      void changeArgs(stateId, values)
                    }
                  />
                ) : (
                  <p className="px-3 py-4 text-[11px] text-[var(--text-faint)]">
                    先选择一个页面。
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </main>
      {helpOpen && <Help onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

export function AppRoot() {
  return (
    <WorkbenchErrorBoundary>
      <App />
    </WorkbenchErrorBoundary>
  )
}
