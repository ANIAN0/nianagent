import { useCallback, useEffect, useRef, useState } from "react"
import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core"
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageErrorBoundary } from "@/components/feedback/page-error-boundary"
import { callPlugin } from "@/features/plugins/plugin-service"

type WorkbenchStatus = {
  running: boolean
  url: string
  port: number
  revision: number
  issue: string
  dataIssue?: string
  logIssue: string
  directories: number
  pages: number
}

// 与 workbench/channel.ts 的 HOST_CHANNEL 一致：两侧独立构建，无法共享模块。
const HOST_CHANNEL = "moon-notes-embed"
// 首帧超时：服务装载前不可达时转回回退卡片，避免长期白框。
const FRAME_TIMEOUT_MS = 10000

const invoke = async <T,>(name: string, input: object, signal?: AbortSignal) =>
  (
    await callPlugin<{ value: T }>(
      "notes-workbench",
      name,
      input,
      undefined,
      signal
    )
  ).value
const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，请重试。"
const pageParam = (pageId: string | null) =>
  pageId ? `&page=${encodeURIComponent(pageId)}` : ""
const pageHash = (pageId: string | null) =>
  pageId ? `#page=${encodeURIComponent(pageId)}` : ""

/**
 * 主导航内嵌的笔记工作台：经一次性票据把 loopback 工作台装进 iframe。
 * 宿主深链在 iframe 就绪后于其内部 hash 导航，不整页重挂；
 * iframe 内的页面切换经消息通道回传，宿主据此保持「浏览器打开」与深链一致。
 * 服务不可用时给出可操作的回退入口。
 */
export function NotesWorkbenchView({
  pageId,
  onPageIdChange,
  onOpenSettings,
  onReturn,
}: {
  pageId?: string | null
  onPageIdChange?: (pageId: string | null) => void
  onOpenSettings: () => void
  onReturn: () => void
}) {
  const [status, setStatus] = useState<WorkbenchStatus | null>(null)
  const [error, setError] = useState("")
  const [frameSrc, setFrameSrc] = useState("")
  const [frameReady, setFrameReady] = useState(false)
  const [frameFailed, setFrameFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const lifetime = useRef<AbortController | null>(null)
  // 期望页面（宿主深链与 iframe 上报在此收敛）与 iframe 实际装载页面；装载后的差异由 onLoad 纠正。
  const wantedPage = useRef<string | null>(pageId ?? null)
  const framePage = useRef<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      controller.abort()
      lifetime.current = null
    }
  }, [])
  const readStatus = useCallback(async () => {
    const controller = lifetime.current
    if (!controller) return
    setError("")
    try {
      setStatus(await invoke<WorkbenchStatus>("status", {}, controller.signal))
    } catch (reason) {
      if (!controller.signal.aborted) setError(message(reason))
    }
  }, [])
  useEffect(() => {
    void readStatus()
  }, [readStatus])
  // 签票据装载 iframe；深链 page 取签发时的最新期望值，后续变化走 hash 导航。
  useEffect(() => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || !status?.running) return
    let alive = true
    invoke<{ ticket: string }>("ticket", {}, controller.signal)
      .then((opened) => {
        if (!alive || controller.signal.aborted) return
        framePage.current = wantedPage.current
        setFrameSrc(
          `${status.url}?ticket=${opened.ticket}${pageParam(wantedPage.current)}`
        )
      })
      .catch((reason) => {
        if (alive && !controller.signal.aborted) setError(message(reason))
      })
    return () => {
      alive = false
    }
  }, [status?.running, status?.url, attempt])
  // 装载超时：iframe 始终未触发 onLoad 视为服务不可达。
  useEffect(() => {
    if (!frameSrc || frameReady) return
    const timer = window.setTimeout(
      () => setFrameFailed(true),
      FRAME_TIMEOUT_MS
    )
    return () => window.clearTimeout(timer)
  }, [frameSrc, frameReady])
  // 宿主深链变化：iframe 就绪后在其内部 hash 导航，不整页重挂。
  useEffect(() => {
    const next = pageId ?? null
    if (next === wantedPage.current) return
    wantedPage.current = next
    const frame = frameRef.current
    if (!frameReady || !frame?.contentWindow) return
    framePage.current = next
    try {
      frame.contentWindow.location.href = `${status?.url ?? ""}${pageHash(next)}`
    } catch {
      /* 服务不可达时由装载超时兜底。 */
    }
  }, [pageId, frameReady, status?.url])
  // iframe 内的页面切换回传宿主；来源限定工作台服务本身。
  useEffect(() => {
    if (!status) return
    const origin = new URL(status.url).origin
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return
      const data = event.data as
        | { source?: string; type?: string; pageId?: unknown }
        | null
      if (!data || data.source !== HOST_CHANNEL || data.type !== "page-changed")
        return
      const next =
        typeof data.pageId === "string" && data.pageId ? data.pageId : null
      wantedPage.current = next
      onPageIdChange?.(next)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [status, onPageIdChange])
  const onFrameLoad = () => {
    setFrameReady(true)
    // 装载期间深链已变化：就绪后立即在 iframe 内补一次 hash 导航。
    const frame = frameRef.current
    if (framePage.current === wantedPage.current || !frame?.contentWindow) return
    framePage.current = wantedPage.current
    try {
      frame.contentWindow.location.href = `${status?.url ?? ""}${pageHash(
        wantedPage.current
      )}`
    } catch {
      /* 服务不可达时由装载超时兜底。 */
    }
  }
  const reopen = useCallback(() => {
    setFrameFailed(false)
    setFrameReady(false)
    setFrameSrc("")
    setAttempt((value) => value + 1)
    void readStatus()
  }, [readStatus])
  const openExternal = async () => {
    if (!status?.running) return
    try {
      const opened = await invoke<{ ticket: string }>("ticket", {})
      const url = `${status.url}?ticket=${opened.ticket}${pageParam(
        wantedPage.current
      )}`
      // 桌面 WebView 不处理 window.open，走系统浏览器（与插件详情页同模式）。
      if (isTauri()) await tauriInvoke("open_local_url", { url })
      else window.open(url, "_blank", "noopener,noreferrer")
    } catch (reason) {
      setError(message(reason))
    }
  }
  const reload = async () => {
    const controller = lifetime.current
    if (!controller) return
    setPending(true)
    try {
      await invoke("reload", {}, controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted) setError(message(reason))
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }
  const usable = status?.running === true && !status.issue
  const hint = frameFailed
    ? "工作台服务无响应；请重试，或前往插件设置检查。"
    : status
      ? status.issue ||
        status.logIssue ||
        "插件未运行；在插件设置里启用「笔记工作台」后重试。"
      : error || "正在读取插件状态…"
  return (
    <PageErrorBoundary>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
          <Button
            variant="ghost"
            size="sm"
            aria-label="返回"
            onClick={onReturn}
          >
            <ArrowLeft className="size-4" />
            返回
          </Button>
          <span className="text-[13px] font-medium">笔记工作台</span>
          {status && (
            <Badge variant={usable ? "secondary" : "outline"}>
              {usable ? `${status.pages} 个页面` : "未运行"}
            </Badge>
          )}
          <span className="flex-1" />
          {usable && (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => void reload()}
              >
                <RefreshCw className="size-3.5" />
                重载资源
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void openExternal()}
              >
                <ExternalLink className="size-3.5" />
                浏览器打开
              </Button>
            </>
          )}
        </header>
        {error && (
          <Alert className="m-3">
            <AlertTitle>操作未完成</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {usable && !frameFailed ? (
          frameSrc ? (
            <iframe
              ref={frameRef}
              src={frameSrc}
              title="笔记工作台"
              className="h-full w-full flex-1 border-0 bg-background"
              onLoad={onFrameLoad}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              正在装载工作台…
            </div>
          )
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md rounded-xl border border-border bg-card p-6 text-sm">
              <p className="font-medium">笔记工作台不可用</p>
              <p className="mt-2 text-muted-foreground">{hint}</p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={onOpenSettings}>
                  前往插件设置
                </Button>
                {(status || error) && (
                  <Button size="sm" variant="ghost" onClick={reopen}>
                    重新读取
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </PageErrorBoundary>
  )
}
