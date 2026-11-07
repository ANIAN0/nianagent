import { Component, type ReactNode } from "react"

/** Manager 级兜底：渲染崩溃不再白屏，给出可操作的恢复入口。 */
export class WorkbenchErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }
  render() {
    if (this.state.error)
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[var(--bg)] px-6 text-center">
          <p className="text-[13px] font-medium text-[var(--danger)]">
            工作台界面崩溃：{this.state.error.message}
          </p>
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      )
    return this.props.children
  }
}

export type Notice = { id: number; kind: "error" | "info"; text: string }

/** 顶部通知条：错误排队展示、逐条关闭；成功刷新由调用方清除错误类通知。 */
export function NoticeBar({
  notices,
  onDismiss,
}: {
  notices: Notice[]
  onDismiss: (id: number) => void
}) {
  if (!notices.length) return null
  return (
    <div className="flex flex-col">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={`flex items-start gap-2 border-b px-4 py-1.5 text-[12px] ${
            notice.kind === "error"
              ? "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning)]"
              : "border-[var(--border)] bg-[var(--panel)] text-[var(--text-2)]"
          }`}
        >
          <span className="min-w-0 flex-1 leading-5 break-words">
            {notice.text}
          </span>
          <button
            type="button"
            aria-label="关闭通知"
            className="shrink-0 text-[13px] leading-5 opacity-60 transition-opacity hover:opacity-100"
            onClick={() => onDismiss(notice.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
