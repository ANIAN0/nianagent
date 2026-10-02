import { useEffect, useRef, useState } from "react"

/** Overview adapts to its panel; the state canvas deliberately keeps an exact viewport. */
export function CatalogPreviewFrame({
  src,
  title,
  initialHeight,
}: {
  src: string
  title: string
  initialHeight: number
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [height, setHeight] = useState(Math.min(initialHeight, 480))
  useEffect(() => {
    function resize(event: MessageEvent) {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return
      if (
        event.data?.type !== "moon-preview-size" ||
        !Number.isFinite(event.data.height)
      )
        return
      setHeight(Math.max(96, Math.min(560, Math.ceil(event.data.height))))
    }
    window.addEventListener("message", resize)
    return () => window.removeEventListener("message", resize)
  }, [])
  return (
    <div className="catalog-responsive-preview" aria-busy={!loaded}>
      {!loaded && (
        <p className="catalog-loading" role="status">
          正在载入组件…
        </p>
      )}
      <iframe
        ref={frame}
        title={title}
        src={`${src}&mode=overview`}
        onLoad={() => setLoaded(true)}
        style={{ width: "100%", height }}
      />
    </div>
  )
}
