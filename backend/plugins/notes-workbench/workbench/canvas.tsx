import { useCallback, useEffect, useRef, useState } from "react"
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
const ZOOMS = [0.5, 0.75, 1, 1.25] as const
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

const toolbarButton = (active: boolean) =>
  `whitespace-nowrap rounded px-2 py-1 text-[11px] transition-colors ${
    active
      ? "bg-[var(--accent)] font-medium text-white"
      : "text-[var(--text-3)] hover:bg-[var(--raised)] hover:text-[var(--text)]"
  }`

export function Canvas({
  detail,
  width,
  height,
  zoom,
  onWidth,
  onHeight,
  onZoom,
  selectedStateId,
  onSelectState,
  onAddComment,
  onFocusComment,
  onToggleStatus,
  onToggleZen,
  onPageSaved,
  onError,
  resourceVersion,
  operations,
}: {
  detail: PageDetail | null
  width: WidthMode
  height: number | null
  zoom: number
  onWidth: (mode: WidthMode) => void
  onHeight: (value: number | null) => void
  onZoom: (value: number) => void
  selectedStateId: string | null
  onSelectState: (stateId: string) => void
  onAddComment: (target: string, text: string) => Promise<void>
  onFocusComment: (commentId: string) => void
  onToggleStatus: (status: "draft" | "confirmed") => Promise<void>
  onToggleZen: () => void
  onPageSaved: () => void
  onError: (text: string) => void
  resourceVersion: number
  operations: Map<string, OperationInfo> | null
}) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [draft, setDraft] = useState("")
  const [mode, setMode] = useState<"browse" | "select">("browse")
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [view, setView] = useState<"canvas" | "docs">("canvas")
  const [copied, setCopied] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [sizeDraft, setSizeDraft] = useState("")
  const [heightDraft, setHeightDraft] = useState("")
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const channelRef = useRef<ReturnType<typeof attachManagerChannel> | null>(
    null
  )
  const pageId = detail?.page.id ?? null
  // 页面切换回到画布视图与浏览模式，避免上一页的圈选残留（渲染期派生调整）。
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
    height: height ?? undefined,
    stateId: selectedState?.id,
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
    []
  )
  const setModeAndClear = (next: "browse" | "select") => {
    setMode(next)
    setSelection(null)
    channelRef.current?.send("clear-selection")
  }
  const applyCustomSize = () => {
    const nextWidth = Number(sizeDraft)
    const nextHeight = Number(heightDraft)
    onWidth(
      sizeDraft === ""
        ? "fit"
        : Number.isInteger(nextWidth) && nextWidth >= 240
          ? nextWidth
          : "fit"
    )
    onHeight(
      heightDraft === "" || !Number.isInteger(nextHeight) || nextHeight < 96
        ? null
        : nextHeight
    )
    setSizeOpen(false)
  }
  const openCustomSize = () => {
    setSizeDraft(width === "fit" ? "" : String(width))
    setHeightDraft(height === null ? "" : String(height))
    setSizeOpen((value) => !value)
  }
  const emptySource = !source && !detail?.page.meta?.preview
  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-4">
        <span className="truncate text-[13px] text-[var(--text)]">
          {detail ? detail.page.title || detail.page.name : "未选择页面"}
        </span>
        {detail && (
          <button
            type="button"
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
              detail.page.status === "confirmed"
                ? "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success)] hover:brightness-110"
                : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)] hover:text-[var(--text-2)]"
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
        {detail?.page.source && (
          <button
            type="button"
            className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-2)]"
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
          <button
            type="button"
            aria-label="聚焦画布"
            title="聚焦画布（F）"
            className="rounded p-1 text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--raised)] hover:text-[var(--text-2)]"
            onClick={onToggleZen}
          >
            ⛶
          </button>
        )}
        {detail && view === "canvas" && (
          <>
            <button
              type="button"
              aria-label="刷新预览"
              title="刷新预览"
              className="rounded p-1 text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--raised)] hover:text-[var(--text-2)]"
              onClick={() => setNonce((value) => value + 1)}
            >
              ↻
            </button>
            <select
              aria-label="缩放"
              title="缩放"
              value={String(zoom)}
              onChange={(event) => onZoom(Number(event.target.value))}
              className="rounded border border-[var(--border)] bg-[var(--raised)] px-1 py-0.5 text-[11px] text-[var(--text-2)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
            >
              {ZOOMS.map((value) => (
                <option key={value} value={value}>
                  {Math.round(value * 100)}%
                </option>
              ))}
            </select>
            <div className="flex rounded border border-[var(--border)] p-0.5">
              {WIDTHS.map((item) => (
                <button
                  key={String(item.id)}
                  type="button"
                  onClick={() => {
                    onWidth(item.id)
                    if (item.id !== "fit") onHeight(null)
                  }}
                  className={`rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap transition-colors ${
                    width === item.id && !sizeOpen
                      ? "bg-[var(--accent)] font-medium text-white"
                      : "text-[var(--text-3)] hover:text-[var(--text)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap transition-colors ${
                  sizeOpen ||
                  (width !== "fit" && !WIDTHS.some((item) => item.id === width))
                    ? "bg-[var(--accent)] font-medium text-white"
                    : "text-[var(--text-3)] hover:text-[var(--text)]"
                }`}
                onClick={openCustomSize}
              >
                自定义
              </button>
            </div>
            {sizeOpen && (
              <div className="absolute top-11 right-4 z-20 flex items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 shadow-xl">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    宽（240–2560）
                  </span>
                  <input
                    autoFocus
                    type="number"
                    min={240}
                    max={2560}
                    value={sizeDraft}
                    onChange={(event) => setSizeDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") applyCustomSize()
                      if (event.key === "Escape") setSizeOpen(false)
                    }}
                    placeholder="适应"
                    className="w-24 rounded bg-[var(--raised)] px-2 py-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    高（≥96，留空不限）
                  </span>
                  <input
                    type="number"
                    min={96}
                    value={heightDraft}
                    onChange={(event) => setHeightDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") applyCustomSize()
                      if (event.key === "Escape") setSizeOpen(false)
                    }}
                    placeholder="不限"
                    className="w-24 rounded bg-[var(--raised)] px-2 py-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </label>
                <div className="flex gap-1.5 pb-0.5">
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[11px] text-[var(--text-3)] transition-colors hover:text-[var(--text)]"
                    onClick={() => setSizeOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="rounded bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
                    onClick={applyCustomSize}
                  >
                    应用
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {detail && (
          <div className="flex rounded border border-[var(--border)] p-0.5">
            {(["canvas", "docs"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  view === item
                    ? "bg-[var(--raised)] font-medium text-[var(--text-strong)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-2)]"
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
        <div className="flex h-9 shrink-0 items-center gap-3 overflow-x-auto border-b border-[var(--border)] bg-[var(--bg-toolbar)] px-4">
          {SECTION_GROUPS.map((group) => {
            const items = states.filter((state) => state.section === group.id)
            if (!items.length) return null
            return (
              <div key={group.id} className="flex items-center gap-1.5">
                <span className="text-[10px] text-[var(--text-faint)]">
                  {group.label}
                </span>
                {items.map((state) => (
                  <button
                    key={state.id}
                    type="button"
                    className={`rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap transition-colors ${
                      selectedState?.id === state.id
                        ? "bg-[var(--accent)] font-medium text-white"
                        : "text-[var(--text-3)] hover:bg-[var(--raised)] hover:text-[var(--text)]"
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
        <Docs
          pageId={detail.page.id}
          detail={detail}
          operations={operations}
          onSaved={onPageSaved}
          onError={onError}
        />
      ) : (
        <>
          <div
            className={`min-h-0 flex-1 bg-[var(--bg)] ${
              pageWidth ? "overflow-auto" : "overflow-hidden"
            }`}
          >
            {empty || emptySource ? (
              <p className="mt-24 text-center text-[13px] text-[var(--text-faint)]">
                {empty
                  ? "从左侧选择一个页面，或让 agent 创建页面。"
                  : "页面源码为空。"}
              </p>
            ) : (
              <div
                className={`flex h-full min-h-full ${pageWidth ? "min-w-max justify-center p-4" : ""}`}
              >
                <iframe
                  key={`${resourceVersion}-${nonce}`}
                  ref={frameRef}
                  src={`/preview.html?v=${resourceVersion}`}
                  title="页面预览"
                  className="origin-top border-0 bg-[var(--canvas-dark)]"
                  style={{
                    width: pageWidth ? `${pageWidth}px` : "100%",
                    height: height ? `${height}px` : "100%",
                    zoom,
                  }}
                  onLoad={attach}
                />
              </div>
            )}
          </div>
          {selection && (
            <div
              className="absolute z-10 w-72 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 shadow-xl"
              style={{
                left: Math.min(
                  selection.frameLeft + selection.clientX * zoom,
                  window.innerWidth - 320
                ),
                top: Math.min(
                  selection.frameTop + selection.clientY * zoom + 8,
                  window.innerHeight - 200
                ),
              }}
            >
              <p className="mb-2 line-clamp-2 font-mono text-[11px] text-[var(--text-muted)]">
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
                    void onAddComment(selection.selector, draft.trim()).then(
                      () => {
                        setSelection(null)
                        setDraft("")
                        channelRef.current?.send("clear-selection")
                      }
                    )
                }}
                placeholder="评论这个元素…"
                className="h-16 w-full resize-none rounded bg-[var(--raised)] p-2 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:ring-1 focus:ring-[var(--accent)]"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs text-[var(--text-3)] transition-colors hover:text-[var(--text)]"
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
                  className="rounded bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
                  onClick={() =>
                    void onAddComment(selection.selector, draft.trim()).then(
                      () => {
                        setSelection(null)
                        setDraft("")
                        channelRef.current?.send("clear-selection")
                      }
                    )
                  }
                >
                  添加评论
                </button>
              </div>
            </div>
          )}
          {!empty && (
            <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
              <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => setModeAndClear("browse")}
                  className={toolbarButton(mode === "browse")}
                  title="页面可正常交互"
                >
                  浏览
                </button>
                <button
                  type="button"
                  onClick={() => setModeAndClear("select")}
                  className={toolbarButton(mode === "select")}
                  title="点选元素添加评论（Esc 退出）"
                >
                  评论
                </button>
                <span className="mx-1 h-4 w-px bg-[var(--border)]" />
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={toolbarButton(theme === "light")}
                  title="浅色画板"
                >
                  亮
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={toolbarButton(theme === "dark")}
                  title="深色画板"
                >
                  暗
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
