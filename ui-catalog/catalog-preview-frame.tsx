import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

/** Overview adapts to its panel; the state canvas deliberately keeps an exact viewport. */
export function CatalogPreviewFrame({
  src,
  title,
  initialHeight,
  mode = "overview",
  width,
  height: canvasHeight,
}: {
  src: string
  title: string
  initialHeight: number
  mode?: "overview" | "canvas"
  width?: number
  height?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [visible, setVisible] = useState(mode === "canvas")
  const mounted = mode === "canvas" || visible
  const [status, setStatus] = useState<{
    src: string
    state: "ready" | "error"
    message?: string
  }>()
  const [attempt, setAttempt] = useState(0)
  const [height, setHeight] = useState(Math.min(initialHeight, 480))
  const url = new URL(src, location.href)
  if (mode === "overview") url.searchParams.set("mode", "overview")
  const previewUrl = url.href
  const ready = status?.src === previewUrl && status.state === "ready"
  const error =
    status?.src === previewUrl && status.state === "error"
      ? status.message
      : undefined
  useEffect(() => {
    if (mode === "canvas" || !container.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "160px" }
    )
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [mode])
  useEffect(() => {
    function resize(event: MessageEvent) {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return
      if (event.data?.search !== new URL(previewUrl).search) return
      if (event.data?.type === "moon-preview-status") {
        if (event.data.status === "ready")
          setStatus({ src: previewUrl, state: "ready" })
        else if (event.data.status === "error")
          setStatus({
            src: previewUrl,
            state: "error",
            message:
              typeof event.data.message === "string"
                ? event.data.message
                : "组件预览失败",
          })
      } else if (
        mode === "overview" &&
        event.data?.type === "moon-preview-size" &&
        Number.isFinite(event.data.height)
      ) {
        setHeight(Math.max(96, Math.min(560, Math.ceil(event.data.height))))
      }
    }
    window.addEventListener("message", resize)
    return () => window.removeEventListener("message", resize)
  }, [previewUrl, mode])
  useEffect(() => {
    if (!mounted || ready || error) return
    const timer = window.setTimeout(
      () =>
        setStatus({
          src: previewUrl,
          state: "error",
          message: "组件载入超时，请检查连接后重试。",
        }),
      20000
    )
    return () => window.clearTimeout(timer)
  }, [mounted, ready, error, previewUrl, attempt])
  return (
    <div
      ref={container}
      className="catalog-responsive-preview"
      aria-busy={mounted && !ready && !error}
      style={
        mode === "canvas"
          ? { width, height: canvasHeight ?? initialHeight }
          : { minHeight: Math.min(initialHeight, 240) }
      }
    >
      {!mounted && <p className="catalog-loading">滚动至此处载入预览</p>}
      {mounted && !ready && !error && (
        <p
          className="catalog-loading"
          role="status"
          aria-live="polite"
          style={{ position: "absolute", inset: 16, pointerEvents: "none" }}
        >
          正在载入组件…
        </p>
      )}
      {error && (
        <div className="catalog-loading catalog-preview-error" role="alert">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStatus(undefined)
              setAttempt((value) => value + 1)
            }}
          >
            重试预览
          </Button>
        </div>
      )}
      {mounted && !error && (
        <iframe
          key={attempt}
          ref={frame}
          title={title}
          src={previewUrl}
          loading={mode === "overview" ? "lazy" : "eager"}
          style={{ width: "100%", height: mode === "canvas" ? "100%" : height }}
        />
      )}
    </div>
  )
}
