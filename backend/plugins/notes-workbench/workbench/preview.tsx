import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import "@tailwindcss/browser"
import { createRoot } from "react-dom/client"
import {
  attachPreviewChannel,
  type RenderStatePayload,
} from "./channel"
import { compilePage } from "./renderer"

type Rect = { x: number; y: number; width: number; height: number }
type PinComment = RenderStatePayload["comments"][number]

const PIN_STYLE: Record<string, string> = {
  user: "bg-[#0d99ff] hover:bg-[#33aaff]",
  agent: "bg-[#a259ff] hover:bg-[#b06fff]",
}

class PageBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  render() {
    if (this.state.error)
      return (
        <div className="m-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          页面运行出错：{this.state.error}
        </div>
      )
    return this.props.children
  }
}

const relativeRect = (el: Element, container: HTMLElement): Rect => {
  const box = el.getBoundingClientRect()
  const base = container.getBoundingClientRect()
  return {
    x: box.left - base.left,
    y: box.top - base.top,
    width: box.width,
    height: box.height,
  }
}

const selectorFor = (el: Element, container: HTMLElement) => {
  const parts: string[] = []
  let node: Element | null = el
  while (node && node !== container) {
    const parent: HTMLElement | null = node.parentElement
    if (!parent) return ""
    const tag: string = node.tagName
    let nth = 0
    const children = parent.children
    for (let index = 0; index < children.length; index += 1) {
      const child = children.item(index)
      if (!child) continue
      if (child.tagName === tag) nth += 1
      if (child === node) break
    }
    parts.unshift(`${tag.toLowerCase()}:nth-of-type(${nth})`)
    node = parent
  }
  return node === container && parts.length ? parts.join(" > ") : ""
}

function PreviewApp() {
  const [state, setState] = useState<RenderStatePayload>({
    source: "",
    preview: "",
    args: {},
    theme: "dark",
    mode: "browse",
    width: undefined,
    comments: [],
  })
  const [hover, setHover] = useState<Rect | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [pins, setPins] = useState<{ comment: PinComment; rect: Rect | null }[]>([])
  const previewVersion = new URLSearchParams(window.location.search).get("v") ?? "0"
  const [entries, setEntries] = useState<Record<string, ComponentType | undefined> | null>(null)
  const [entriesError, setEntriesError] = useState("")
  useEffect(() => {
    if (!state.preview || entries) return
    let alive = true
    import(`/preview/bundle.mjs?v=${previewVersion}`)
      .then((module) => {
        if (alive) setEntries((module.entries ?? {}) as Record<string, ComponentType | undefined>)
      })
      .catch((error) => {
        if (alive) setEntriesError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      alive = false
    }
  }, [state.preview, entries, previewVersion])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })
  const channelRef = useRef<ReturnType<typeof attachPreviewChannel> | null>(null)
  if (channelRef.current == null) {
    channelRef.current = attachPreviewChannel({
      onRenderState: (payload) => {
        setState(payload)
        if (payload.mode !== "select") {
          setHover(null)
          setSelection(null)
        }
      },
      onClearSelection: () => setSelection(null),
    })
  }
  const compiled = compilePage(state.source)
  const pinKeyRef = useRef("")
  const locate = () => containerRef.current?.firstElementChild
  const measure = () => {
    const container = containerRef.current
    const first = locate()
    if (!container || !(first instanceof HTMLElement)) {
      if (pinKeyRef.current !== "none") {
        pinKeyRef.current = "none"
        setPins([])
      }
      return
    }
    const next = stateRef.current.comments.map((comment) => {
      if (!comment.target) return { comment, rect: null }
      try {
        const el = first.querySelector(comment.target)
        return el
          ? { comment, rect: relativeRect(el, first) }
          : { comment, rect: null }
      } catch {
        return { comment, rect: null }
      }
    })
    const key = JSON.stringify(next.map((pin) => pin.rect))
    if (key === pinKeyRef.current) return
    pinKeyRef.current = key
    setPins(next)
  }
  useLayoutEffect(() => {
    // 后台标签的 rAF 会被暂停，pin 定位改用宏任务。
    const timer = setTimeout(measure, 0)
    return () => clearTimeout(timer)
  })
  useLayoutEffect(() => {
    const first = locate()
    if (!first || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => measure())
    observer.observe(first)
    return () => observer.disconnect()
  })
  const handlePointerMove = (event: ReactPointerEvent) => {
    if (state.mode !== "select" || selection) return
    const first = locate()
    const el = event.target
    if (
      !(first instanceof HTMLElement) ||
      !(el instanceof Element) ||
      el === first ||
      !first.contains(el)
    ) {
      setHover(null)
      return
    }
    setHover(relativeRect(el, first))
  }
  const handleClick = (event: ReactMouseEvent) => {
    if (state.mode !== "select") return
    const first = locate()
    const el = event.target
    if (
      !(first instanceof HTMLElement) ||
      !(el instanceof Element) ||
      el === first ||
      !first.contains(el)
    )
      return
    const selector = selectorFor(el, first)
    if (!selector) return
    setHover(null)
    setSelection(relativeRect(el, first))
    channelRef.current?.send("picked", {
      selector,
      text: (el.textContent || "").trim().slice(0, 200),
      clientX: event.clientX,
      clientY: event.clientY,
    })
  }
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape" && state.mode === "select")
      channelRef.current?.send("escape")
  }
  const emptySource = !state.source && !state.preview
  const previewComponent: ComponentType | "loading" | "error" | "missing" | null =
    state.preview
      ? entriesError
        ? "error"
        : entries
          ? (entries[state.preview] ?? "missing")
          : "loading"
      : null
  return (
    <div className="min-h-screen p-10" onKeyDown={handleKeyDown}>
      {emptySource ? (
        <p className="mt-16 text-center text-[13px] text-neutral-500">
          等待页面源码…
        </p>
      ) : (
        <div
          ref={containerRef}
          className="relative mx-auto"
          style={{
            width: state.width ?? "100%",
            minHeight: 240,
            colorScheme: state.theme,
            background: "light-dark(#ffffff, #16181d)",
          }}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHover(null)}
          onClick={handleClick}
        >
          {previewComponent ? (
            previewComponent === "loading" ? (
              <p className="m-6 text-[13px] text-neutral-500">加载预览条目…</p>
            ) : previewComponent === "error" ? (
              <div className="m-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
                预览模块加载失败：{entriesError}
              </div>
            ) : previewComponent === "missing" ? (
              <div className="m-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
                预览条目不存在：{state.preview}。请核对 preview/manifest.mjs 并重建。
              </div>
            ) : (
              <PageBoundary key={state.preview}>
                {(() => {
                  const Preview = previewComponent as ComponentType
                  return <Preview {...state.args} />
                })()}
              </PageBoundary>
            )
          ) : compiled.ok ? (
            <PageBoundary key={state.source}>
              <compiled.component {...state.args} />
            </PageBoundary>
          ) : (
            <div className="m-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
              源码编译失败：{compiled.error}
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {hover && !selection && (
              <div
                className="absolute border border-[#0d99ff]"
                style={{
                  left: hover.x,
                  top: hover.y,
                  width: hover.width,
                  height: hover.height,
                }}
              />
            )}
            {selection && (
              <div
                className="absolute border-2 border-[#0d99ff]"
                style={{
                  left: selection.x,
                  top: selection.y,
                  width: selection.width,
                  height: selection.height,
                }}
              />
            )}
            {pins.map(({ comment, rect }) => {
              if (!rect) return null
              const kind = comment.author === "agent" ? "agent" : "user"
              return (
                <button
                  key={comment.id}
                  type="button"
                  className={`pointer-events-auto absolute flex h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded-full px-1.5 text-[11px] font-medium text-white shadow-md transition-colors ${
                    comment.resolved
                      ? "bg-[#4a4a4a] opacity-60 hover:opacity-90"
                      : PIN_STYLE[kind]
                  }`}
                  style={{ left: rect.x + rect.width + 8, top: rect.y + 2 }}
                  onClick={(event) => {
                    event.stopPropagation()
                    channelRef.current?.send("pin-click", { commentId: comment.id })
                  }}
                >
                  {comment.author === "agent" ? "A" : "U"}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<PreviewApp />)
