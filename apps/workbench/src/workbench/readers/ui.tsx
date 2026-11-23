"use client"

// UI 产物阅读器（T14）：随机会话子域 iframe 内嵌，产物免构建直接体验。
// 支持体验/评论模式切换、manifest 多路由切换、视口宽度预设、已评论数量提示。
import { useEffect, useMemo, useRef, useState } from "react"
import type { ReaderProps } from "../reader-registry"
import { isNotesPreviewSessionId, v2Api } from "../v2-api"
import { Button } from "@/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select"

type ViewportPreset = "full" | "desktop" | "tablet" | "mobile"

const PREVIEW_READY_TIMEOUT_MS = 15000

const VIEWPORT_WIDTHS: Record<ViewportPreset, string | undefined> = {
  full: undefined,
  desktop: "1280px",
  tablet: "768px",
  mobile: "390px",
}

export function UiReader({
  version,
  threads,
  onTargetSelect,
  focusRequest,
  onReport,
}: ReaderProps) {
  const [loaded, setLoaded] = useState<{
    versionId: string
    attempt: number
    sessionUrl: string | null
    sid: string
    error: string
  } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [frameState, setFrameState] = useState<{
    sessionUrl: string
    status: "loading" | "ready" | "failed"
    page?: string
  } | null>(null)
  const frameTimer = useRef<number | undefined>(undefined)
  const [mode, setMode] = useState<"experience" | "comment">("experience")
  const [viewport, setViewport] = useState<ViewportPreset>("full")
  const [notice, setNotice] = useState("")
  const frameRef = useRef<HTMLIFrameElement>(null)
  const current =
    loaded?.versionId === version.versionId && loaded.attempt === attempt
      ? loaded
      : null
  const sessionUrl = current?.sessionUrl ?? null

  const routes = useMemo(
    () => Object.keys(version.manifest?.routes ?? {}),
    [version.manifest]
  )
  const currentFrame = frameState?.sessionUrl === sessionUrl ? frameState : null
  const page = currentFrame?.page

  const selectRoute = (route: string) => {
    const frame = frameRef.current
    if (!frame || !sessionUrl || !routes.includes(route)) return
    const url = new URL(sessionUrl)
    url.pathname = route
    setFrameState({ sessionUrl, status: "loading", page: route })
    window.clearTimeout(frameTimer.current)
    frameTimer.current = window.setTimeout(() => {
      setFrameState({ sessionUrl, status: "failed", page: route })
    }, PREVIEW_READY_TIMEOUT_MS)
    frame.src = url.href
  }

  const uiThreadCount = useMemo(
    () => threads.filter((thread) => thread.anchor.kind === "ui").length,
    [threads]
  )

  useEffect(() => {
    let cancelled = false
    let sid: string | undefined
    const versionId = version.versionId
    const close = (ownedSid: string) => {
      void v2Api.closePreview(ownedSid, versionId).catch((error) => {
        console.error("预览会话释放失败", error)
      })
    }
    v2Api
      .openPreview(versionId)
      .then((result) => {
        if (!isNotesPreviewSessionId(result.sid)) {
          throw new Error("预览会话回执无效。")
        }
        sid = result.sid
        if (cancelled) {
          close(sid)
          return
        }
        const url = new URL(result.sessionUrl)
        const port = window.location.port
        if (url.href !== `http://${sid}.localhost:${port}/`) {
          throw new Error("预览地址无效。")
        }
        setLoaded({ versionId, attempt, sessionUrl: url.href, sid, error: "" })
        setNotice("")
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          if (sid) close(sid)
          sid = undefined
          setLoaded({
            versionId,
            attempt,
            sessionUrl: null,
            sid: "",
            error: error instanceof Error ? error.message : "打开预览失败。",
          })
        }
      })
    return () => {
      cancelled = true
      if (sid) close(sid)
    }
  }, [version.versionId, attempt])

  useEffect(() => {
    if (!sessionUrl) return
    frameTimer.current = window.setTimeout(() => {
      setFrameState({ sessionUrl, status: "failed" })
    }, PREVIEW_READY_TIMEOUT_MS)
    return () => window.clearTimeout(frameTimer.current)
  }, [sessionUrl])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !sessionUrl) return
    frame.contentWindow?.postMessage(
      { type: "moon-preview-mode", mode },
      new URL(sessionUrl).origin
    )
  }, [mode, sessionUrl])

  const requestRef = useRef<ReaderProps["focusRequest"]>(null)
  useEffect(() => {
    requestRef.current = focusRequest ?? null
  })
  const deliverRef = useRef<() => void>(() => {})
  useEffect(() => {
    deliverRef.current = () => {
      const request = requestRef.current
      const frame = frameRef.current
      if (
        !request ||
        request.status !== "pending" ||
        !frame ||
        !sessionUrl ||
        !loaded?.sid
      )
        return
      if (request.versionId !== loaded.versionId) return
      const origin = new URL(sessionUrl, window.location.origin).origin
      frame.contentWindow?.postMessage(
        {
          type: "moon-preview-focus",
          requestId: request.requestId,
          target: request.target,
        },
        origin
      )
    }
  })
  useEffect(() => {
    if (focusRequest?.status === "pending") deliverRef.current()
  }, [focusRequest])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      if (!frame || !sessionUrl || event.source !== frame.contentWindow) return
      const expectedOrigin = new URL(sessionUrl, window.location.origin).origin
      if (event.origin !== expectedOrigin) return
      const data = event.data as {
        type?: unknown
        target?: unknown
        page?: unknown
        elements?: unknown
        reason?: unknown
        requestId?: unknown
      } | null
      if (data?.type === "moon-preview-inventory") {
        if (!loaded?.sid) return
        if (typeof data.page !== "string" || !Array.isArray(data.elements)) {
          setNotice("元素清单结构无效，未上报。")
          return
        }
        void v2Api
          .previewInventory({
            versionId: loaded.versionId,
            sid: loaded.sid,
            page: data.page,
            elements: data.elements,
          })
          .catch(() => {
            setNotice("元素清单上报失败；预览将随下次加载重试。")
          })
        return
      }
      if (data?.type === "moon-preview-ready") {
        window.clearTimeout(frameTimer.current)
        setFrameState({
          sessionUrl,
          status: "ready",
          page: typeof data.page === "string" ? data.page : undefined,
        })
        const origin = new URL(sessionUrl, window.location.origin).origin
        frame.contentWindow?.postMessage(
          { type: "moon-preview-mode", mode },
          origin
        )
        frame.contentWindow?.postMessage(
          { type: "moon-preview-collect" },
          origin
        )
        deliverRef.current()
        return
      }
      if (
        data?.type === "moon-preview-focus-ok" ||
        data?.type === "moon-preview-focus-miss"
      ) {
        const request = requestRef.current
        if (!request || data.requestId !== request.requestId) return
        if (data.type === "moon-preview-focus-miss") {
          onReport?.(
            request.requestId,
            "failed",
            data.reason === "page"
              ? "目标页面导航失败，无法定位。"
              : "目标元素在该页面不可定位。"
          )
        } else {
          onReport?.(request.requestId, "delivered")
        }
        return
      }
      if (data?.type === "moon-preview-notice") {
        setNotice("跨页定位记录读取失败，请重新点击意见。")
        return
      }
      if (data?.type !== "moon-preview-target" || mode !== "comment") return
      const target = (data?.target ?? null) as
        Record<string, unknown> | null | undefined
      if (
        !target ||
        typeof target !== "object" ||
        Array.isArray(target) ||
        target.kind !== "ui" ||
        typeof target.page !== "string" ||
        target.page.length < 1 ||
        typeof target.tag !== "string" ||
        target.tag.length < 1
      )
        return
      onTargetSelect?.(target)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [onTargetSelect, sessionUrl, loaded, onReport, mode])

  const presetWidth = VIEWPORT_WIDTHS[viewport]

  const status = currentFrame?.status ?? "loading"
  const error =
    current?.error || (status === "failed" ? "预览未能连接，请重试。" : "")
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-2 text-sm">
        <ToggleGroup
          type="single"
          size="sm"
          value={mode}
          onValueChange={(value) => {
            if (value === "experience" || value === "comment") setMode(value)
          }}
          aria-label="预览模式"
        >
          <ToggleGroupItem value="experience">体验</ToggleGroupItem>
          <ToggleGroupItem value="comment">评论</ToggleGroupItem>
        </ToggleGroup>
        {routes.length > 1 && (
          <Select
            value={page && routes.includes(page) ? page : (routes[0] ?? "/")}
            onValueChange={selectRoute}
          >
            <SelectTrigger
              size="sm"
              aria-label="预览页面路由"
              className="min-w-28 font-mono text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {routes.map((item) => (
                <SelectItem
                  key={item}
                  value={item}
                  className="font-mono text-xs"
                >
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={viewport}
          onValueChange={(value) => setViewport(value as ViewportPreset)}
        >
          <SelectTrigger size="sm" aria-label="视口宽度" className="min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">自适应宽度</SelectItem>
            <SelectItem value="desktop">桌面 1280px</SelectItem>
            <SelectItem value="tablet">平板 768px</SelectItem>
            <SelectItem value="mobile">手机 390px</SelectItem>
          </SelectContent>
        </Select>
        {uiThreadCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {uiThreadCount} 条元素定位讨论
          </span>
        )}
        {error && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              role="alert"
              className="min-w-0 text-xs break-words text-destructive"
            >
              {error}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setAttempt(attempt + 1)}
            >
              重试
            </Button>
          </div>
        )}
        {sessionUrl && status === "loading" && (
          <span role="status" className="text-xs text-muted-foreground">
            正在连接预览…
          </span>
        )}
        {notice && !error && (
          <span className="min-w-0 text-xs break-words text-muted-foreground">
            {notice}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-background">
        {sessionUrl ? (
          <div
            className={
              presetWidth
                ? "mx-auto h-full border-x bg-card shadow-sm transition-[width]"
                : "h-full w-full"
            }
            style={
              presetWidth ? { width: presetWidth, maxWidth: "100%" } : undefined
            }
          >
            <iframe
              key={sessionUrl}
              ref={frameRef}
              src={sessionUrl}
              title="界面产物预览"
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms"
              onLoad={() => {
                const frame = frameRef.current
                if (!frame || !sessionUrl) return
                window.clearTimeout(frameTimer.current)
                frameTimer.current = window.setTimeout(() => {
                  setFrameState({ sessionUrl, status: "failed" })
                }, PREVIEW_READY_TIMEOUT_MS)
                frame.contentWindow?.postMessage(
                  { type: "moon-preview-connect" },
                  new URL(sessionUrl).origin
                )
              }}
            />
          </div>
        ) : !error ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            正在打开预览会话…
          </p>
        ) : null}
      </div>
    </div>
  )
}
