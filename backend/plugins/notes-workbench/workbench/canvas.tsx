import {
  Component,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { compilePage } from "./renderer"
import type { Comment, PageDetail } from "./types"

type Rect = { x: number; y: number; width: number; height: number }
type Selection = {
  target: string
  text: string
  rect: Rect
  clientX: number
  clientY: number
}
type Pin = { comment: Comment; rect: Rect | null }

const WIDTHS = [
  { id: "fit", label: "适应" },
  { id: "1280", label: "1280" },
  { id: "768", label: "768" },
  { id: "375", label: "375" },
] as const
export type WidthMode = (typeof WIDTHS)[number]["id"]
type Mode = "browse" | "select"
type Theme = "light" | "dark"

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

export function Canvas({
  detail,
  width,
  onWidth,
  onAddComment,
  onFocusComment,
  onToggleStatus,
}: {
  detail: PageDetail | null
  width: WidthMode
  onWidth: (mode: WidthMode) => void
  onAddComment: (target: string, text: string) => Promise<void>
  onFocusComment: (commentId: string) => void
  onToggleStatus: (status: "draft" | "confirmed") => Promise<void>
}) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<Rect | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [draft, setDraft] = useState("")
  const [pins, setPins] = useState<Pin[]>([])
  const [mode, setMode] = useState<Mode>("browse")
  const [theme, setTheme] = useState<Theme>("dark")
  const source = detail?.page.source ?? ""
  const compiled = useMemo(() => compilePage(source), [source])
  const comments = useMemo(() => detail?.comments ?? [], [detail])

  const locate = useCallback(() => {
    const container = shellRef.current?.firstElementChild
    return container instanceof HTMLElement ? container : null
  }, [])
  const measure = useCallback(() => {
    const container = locate()
    if (!container) {
      setPins([])
      return
    }
    setPins(
      comments.map((comment) => {
        if (!comment.target) return { comment, rect: null }
        try {
          const el = container.querySelector(comment.target)
          return el
            ? { comment, rect: relativeRect(el, container) }
            : { comment, rect: null }
        } catch {
          return { comment, rect: null }
        }
      })
    )
  }, [comments, locate])
  useLayoutEffect(() => {
    // 后台标签的 rAF 会被暂停，pin 定位改用宏任务。
    const timer = setTimeout(measure, 0)
    return () => clearTimeout(timer)
  }, [measure])
  useLayoutEffect(() => {
    const container = locate()
    if (!container || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => measure())
    observer.observe(container)
    return () => observer.disconnect()
  }, [locate, measure, source, width])

  const pageWidth = width === "fit" ? undefined : Number(width)
  const empty = !detail
  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#3c3c3c] bg-[#2c2c2c] px-4">
        <span className="truncate text-[13px] text-neutral-200">
          {detail ? detail.page.title || detail.page.name : "未选择页面"}
        </span>
        {detail && (
          <button
            type="button"
            className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
              detail.page.status === "confirmed"
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                : "border-neutral-600 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300"
            }`}
            onClick={() =>
              void onToggleStatus(
                detail.page.status === "confirmed" ? "draft" : "confirmed"
              )
            }
            title="确认后即可让 agent 把源码写入项目"
          >
            {detail.page.status === "confirmed" ? "已确认" : "草稿"}
          </button>
        )}
        <span className="flex-1" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#1e1e1e] p-10">
        {empty ? (
          <p className="mt-24 text-center text-[13px] text-neutral-600">
            从左侧选择一个页面，或让 agent 创建页面。
          </p>
        ) : (
          <div
            ref={shellRef}
            className="relative mx-auto overflow-hidden rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.5)] ring-1 ring-black/60"
            style={{
              width: pageWidth ?? "100%",
              minHeight: 240,
              colorScheme: theme,
              background: "light-dark(#ffffff, #16181d)",
            }}
            onPointerMove={(event) => {
              if (mode !== "select" || selection) return
              const container = locate()
              const el = event.target
              if (
                !container ||
                !(el instanceof Element) ||
                el === container ||
                !container.contains(el)
              ) {
                setHover(null)
                return
              }
              setHover(relativeRect(el, container))
            }}
            onPointerLeave={() => setHover(null)}
            onClick={(event) => {
              if (mode !== "select") return
              const container = locate()
              const el = event.target
              if (
                !container ||
                !(el instanceof Element) ||
                el === container ||
                !container.contains(el)
              )
                return
              const target = selectorFor(el, container)
              if (!target) return
              setHover(null)
              setSelection({
                target,
                text: (el.textContent || "").trim().slice(0, 200),
                rect: relativeRect(el, container),
                clientX: event.clientX,
                clientY: event.clientY,
              })
              setDraft("")
            }}
          >
            {compiled.ok ? (
              <PageBoundary key={source}>
                <compiled.component />
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
                    left: selection.rect.x,
                    top: selection.rect.y,
                    width: selection.rect.width,
                    height: selection.rect.height,
                  }}
                >
                  {[
                    "-left-[3px] -top-[3px]",
                    "-right-[3px] -top-[3px]",
                    "-left-[3px] -bottom-[3px]",
                    "-right-[3px] -bottom-[3px]",
                  ].map((position) => (
                    <span
                      key={position}
                      className={`absolute ${position} h-1.5 w-1.5 border border-[#0d99ff] bg-white`}
                    />
                  ))}
                </div>
              )}
              {pins.map(({ comment, rect }) => {
                if (!rect) return null
                const kind = comment.author === "agent" ? "agent" : "user"
                return (
                  <button
                    key={comment.id}
                    type="button"
                    className={`pointer-events-auto absolute flex h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded-full px-1.5 text-[11px] font-medium text-white shadow-md transition-colors ${PIN_STYLE[kind]}`}
                    style={{ left: rect.x + rect.width + 8, top: rect.y + 2 }}
                    onClick={(event) => {
                      event.stopPropagation()
                      onFocusComment(comment.id)
                    }}
                  >
                    {comment.author === "agent" ? "A" : "U"}
                  </button>
                )
              })}
            </div>
            {selection && (
              <div
                className="absolute z-10 w-72 rounded-lg border border-[#3c3c3c] bg-[#2c2c2c] p-3 shadow-xl"
                style={{
                  left: Math.min(selection.clientX, window.innerWidth - 320),
                  top: Math.min(selection.clientY + 8, window.innerHeight - 200),
                }}
                onClick={(event) => event.stopPropagation()}
                onPointerMove={(event) => event.stopPropagation()}
              >
                <p className="mb-2 line-clamp-2 font-mono text-[11px] text-neutral-500">
                  {selection.text || selection.target}
                </p>
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.ctrlKey || event.metaKey) &&
                      draft.trim()
                    )
                      void onAddComment(selection.target, draft.trim()).then(
                        () => setSelection(null)
                      )
                  }}
                  placeholder="评论这个元素…"
                  className="h-16 w-full resize-none rounded bg-[#383838] p-2 text-xs text-neutral-200 outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0d99ff]"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-neutral-400 transition-colors hover:text-neutral-200"
                    onClick={() => setSelection(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={!draft.trim()}
                    className="rounded bg-[#0d99ff] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#33aaff] disabled:opacity-40"
                    onClick={() =>
                      void onAddComment(selection.target, draft.trim()).then(
                        () => setSelection(null)
                      )
                    }
                  >
                    添加评论
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {!empty && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-[#3c3c3c] bg-[#2c2c2c] p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMode("browse")
                setHover(null)
                setSelection(null)
              }}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] transition-colors ${
                mode === "browse"
                  ? "bg-[#0d99ff] font-medium text-white"
                  : "text-neutral-400 hover:bg-[#383838] hover:text-neutral-200"
              }`}
              title="页面可正常交互"
            >
              浏览
            </button>
            <button
              type="button"
              onClick={() => setMode("select")}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] transition-colors ${
                mode === "select"
                  ? "bg-[#0d99ff] font-medium text-white"
                  : "text-neutral-400 hover:bg-[#383838] hover:text-neutral-200"
              }`}
              title="点选元素添加评论"
            >
              评论
            </button>
            <span className="mx-1 h-4 w-px bg-[#3c3c3c]" />
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] transition-colors ${
                theme === "light"
                  ? "bg-[#0d99ff] font-medium text-white"
                  : "text-neutral-400 hover:bg-[#383838] hover:text-neutral-200"
              }`}
              title="浅色画板"
            >
              亮
            </button>
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] transition-colors ${
                theme === "dark"
                  ? "bg-[#0d99ff] font-medium text-white"
                  : "text-neutral-400 hover:bg-[#383838] hover:text-neutral-200"
              }`}
              title="深色画板"
            >
              暗
            </button>
            <span className="mx-1 h-4 w-px bg-[#3c3c3c]" />
            {WIDTHS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onWidth(item.id)}
                className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] transition-colors ${
                  width === item.id
                    ? "bg-[#0d99ff] font-medium text-white"
                    : "text-neutral-400 hover:bg-[#383838] hover:text-neutral-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
