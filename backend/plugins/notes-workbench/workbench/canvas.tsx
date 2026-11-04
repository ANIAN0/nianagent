import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { Docs } from "./docs"
import {
  attachManagerChannel,
  type PickedPayload,
  type RenderStatePayload,
} from "./channel"
import type { PageDetail } from "./types"

export type OperationInfo = { module: string; method: string; title: string }

const WIDTHS = [
  { id: "fit", label: "适应" },
  { id: 1280, label: "1280" },
  { id: 768, label: "768" },
  { id: 375, label: "375" },
] as const
export type WidthMode = "fit" | number
const SECTION_GROUPS = [
  { id: "normal", label: "正常流程" },
  { id: "exception", label: "异常流程" },
  { id: "states", label: "不同状态" },
] as const

type Selection = {
  selector: string
  text: string
  frameLeft: number
  frameTop: number
  clientX: number
  clientY: number
}

export function Canvas({
  detail,
  width,
  onWidth,
  selectedStateId,
  onSelectState,
  onAddComment,
  onFocusComment,
  onToggleStatus,
  resourceVersion,
  operations,
}: {
  detail: PageDetail | null
  width: WidthMode
  onWidth: (mode: WidthMode) => void
  selectedStateId: string | null
  onSelectState: (stateId: string) => void
  onAddComment: (target: string, text: string) => Promise<void>
  onFocusComment: (commentId: string) => void
  onToggleStatus: (status: "draft" | "confirmed") => Promise<void>
  resourceVersion: number
  operations: Map<string, OperationInfo> | null
}) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [draft, setDraft] = useState("")
  const [mode, setMode] = useState<"browse" | "select">("browse")
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [view, setView] = useState<"canvas" | "docs">("canvas")
  const [copied, setCopied] = useState(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const channelRef = useRef<ReturnType<typeof attachManagerChannel> | null>(null)
  const pageId = detail?.page.id ?? null
  // 页面切换回到画布视图与浏览模式，避免上一页的圈选残留。
  const [previousPageId, setPreviousPageId] = useState<string | null>(null)
  if (pageId !== previousPageId) {
    setPreviousPageId(pageId)
    setView("canvas")
    setMode("browse")
    setSelection(null)
  }
  const states = detail?.page.states ?? []
  const selectedState =
    states.find((state) => state.id === selectedStateId) ??
    states.find((state) => state.section === "normal") ??
    states[0] ??
    null
  const comments = detail?.comments ?? []
  const source = detail?.page.source ?? ""
  const pageWidth = width === "fit" ? undefined : width
  const empty = !detail

  // 通道随 iframe 重建；ready 前的渲染状态由通道缓冲，就绪后立即下发。
  const payload: RenderStatePayload = {
    source,
    preview: detail?.page.meta?.preview ?? "",
    args: selectedState?.args ?? {},
    theme,
    mode,
    width: pageWidth,
    comments: comments.map((comment) => ({
      id: comment.id,
      author: comment.author,
      resolved: comment.resolved,
      target: comment.target,
    })),
  }
  const payloadKey = JSON.stringify(payload)
  const payloadRef = useRef(payloadKey)
  const attach = useCallback(() => {
    const frame = frameRef.current
    if (!frame?.contentWindow) return
    channelRef.current?.dispose()
    const origin = window.location.origin
    channelRef.current = attachManagerChannel(frame.contentWindow, origin, {
      onPicked: (value: PickedPayload) => {
        const rect = frameRef.current?.getBoundingClientRect()
        setSelection({
          ...value,
          frameLeft: rect?.left ?? 0,
          frameTop: rect?.top ?? 0,
        })
      },
      onPinClick: (commentId) => onFocusComment(commentId),
      onEscape: () => setMode("browse"),
    })
    channelRef.current.send("render-state", JSON.parse(payloadRef.current))
  }, [onFocusComment])
  useEffect(() => {
    payloadRef.current = payloadKey
    channelRef.current?.send("render-state", JSON.parse(payloadKey))
  }, [payloadKey])
  useEffect(
    () => () => {
      channelRef.current?.dispose()
      channelRef.current = null
    },
    [],
  )
  const setModeAndClear = (next: "browse" | "select") => {
    setMode(next)
    setSelection(null)
    channelRef.current?.send("clear-selection")
  }
  const emptySource = !source && !detail?.page.meta?.preview
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
                detail.page.status === "confirmed" ? "draft" : "confirmed",
              )
            }
            title="确认后即可让 agent 把源码写入项目"
          >
            {detail.page.status === "confirmed" ? "已确认" : "草稿"}
          </button>
        )}
        {detail?.page.source && (
          <button
            type="button"
            className="rounded border border-neutral-600 px-1.5 py-0.5 text-[11px] text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-300"
            onClick={() => {
              void navigator.clipboard
                .writeText(detail.page.source)
                .then(() => setCopied(true))
                .finally(() => setTimeout(() => setCopied(false), 1500))
            }}
            title="复制页面源码到剪贴板"
          >
            {copied ? "已复制" : "复制源码"}
          </button>
        )}
        <span className="flex-1" />
        {detail && (
          <div className="flex rounded border border-[#3c3c3c] p-0.5">
            {(["canvas", "docs"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  view === item
                    ? "bg-[#383838] font-medium text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
                onClick={() => setView(item)}
              >
                {item === "canvas" ? "画布" : "文档"}
              </button>
            ))}
          </div>
        )}
      </div>
      {detail && states.length > 0 && view === "canvas" && (
        <div className="flex h-9 shrink-0 items-center gap-3 overflow-x-auto border-b border-[#3c3c3c] bg-[#262626] px-4">
          {SECTION_GROUPS.map((group) => {
            const items = states.filter((state) => state.section === group.id)
            if (!items.length) return null
            return (
              <div key={group.id} className="flex items-center gap-1.5">
                <span className="text-[10px] text-neutral-600">{group.label}</span>
                {items.map((state) => (
                  <button
                    key={state.id}
                    type="button"
                    className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                      selectedState?.id === state.id
                        ? "bg-[#0d99ff] font-medium text-white"
                        : "text-neutral-400 hover:bg-[#383838] hover:text-neutral-200"
                    }`}
                    onClick={() => onSelectState(state.id)}
                    title={state.condition || state.name}
                  >
                    {state.name}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {view === "docs" && detail ? (
        <Docs detail={detail} operations={operations} />
      ) : (
        <>
          <div className="min-h-0 flex-1 bg-[#1e1e1e]">
            {empty || emptySource ? (
              <p className="mt-24 text-center text-[13px] text-neutral-600">
                {empty
                  ? "从左侧选择一个页面，或让 agent 创建页面。"
                  : "页面源码为空。"}
              </p>
            ) : (
              <iframe
                key={resourceVersion}
                ref={frameRef}
                src={`/preview.html?v=${resourceVersion}`}
                title="页面预览"
                className="h-full w-full border-0"
                onLoad={attach}
              />
            )}
          </div>
          {selection && (
            <div
              className="absolute z-10 w-72 rounded-lg border border-[#3c3c3c] bg-[#2c2c2c] p-3 shadow-xl"
              style={{
                left: Math.min(
                  selection.frameLeft + selection.clientX,
                  window.innerWidth - 320,
                ),
                top: Math.min(
                  selection.frameTop + selection.clientY + 8,
                  window.innerHeight - 200,
                ),
              }}
            >
              <p className="mb-2 line-clamp-2 font-mono text-[11px] text-neutral-500">
                {selection.text || selection.selector}
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
                    void onAddComment(selection.selector, draft.trim()).then(() => {
                      setSelection(null)
                      setDraft("")
                      channelRef.current?.send("clear-selection")
                    })
                }}
                placeholder="评论这个元素…"
                className="h-16 w-full resize-none rounded bg-[#383838] p-2 text-xs text-neutral-200 outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0d99ff]"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs text-neutral-400 transition-colors hover:text-neutral-200"
                  onClick={() => {
                    setSelection(null)
                    setDraft("")
                    channelRef.current?.send("clear-selection")
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!draft.trim()}
                  className="rounded bg-[#0d99ff] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#33aaff] disabled:opacity-40"
                  onClick={() =>
                    void onAddComment(selection.selector, draft.trim()).then(() => {
                      setSelection(null)
                      setDraft("")
                      channelRef.current?.send("clear-selection")
                    })
                  }
                >
                  添加评论
                </button>
              </div>
            </div>
          )}
          {!empty && (
            <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
              <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-[#3c3c3c] bg-[#2c2c2c] p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => setModeAndClear("browse")}
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
                  onClick={() => setModeAndClear("select")}
                  className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] transition-colors ${
                    mode === "select"
                      ? "bg-[#0d99ff] font-medium text-white"
                      : "text-neutral-400 hover:bg-[#383838] hover:text-neutral-200"
                  }`}
                  title="点选元素添加评论（Esc 退出）"
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
                    key={String(item.id)}
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
        </>
      )}
    </div>
  )
}
