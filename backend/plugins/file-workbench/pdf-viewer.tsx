import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { MediaPosition } from "./web"
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist"
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import "pdfjs-dist/web/pdf_viewer.css"
import { Button } from "@/components/ui/button"
import type { PluginContext } from "@/features/plugins/plugin-api"
import { useFileWorkbenchService } from "./file-service"
import type { MaterialReference } from "@/contracts/rpc.generated"

GlobalWorkerOptions.workerSrc = worker
export function PdfViewer({
  data,
  path,
  sessionId,
  onMaterial,
  position,
  onPosition,
}: {
  data: Uint8Array
  path: string
  sessionId: string
  onMaterial: PluginContext["reference"]
  position?: MediaPosition
  onPosition: (position: MediaPosition) => void
}) {
  const { call } = useFileWorkbenchService()
  const [document, setDocument] = useState<PDFDocumentProxy>()
  const [page, setPage] = useState(position?.page || 1)
  const [zoom, setZoom] = useState(position?.zoom || 0)
  const latestPosition = useRef(position)
  const renderingReady = useRef(false)
  useLayoutEffect(() => {
    latestPosition.current = position
  }, [position])
  const [width, setWidth] = useState(400)
  const [selected, setSelected] = useState("")
  const [error, setError] = useState("")
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const quoteRequest = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      quoteRequest.current?.abort()
    },
    [page, data]
  )
  useEffect(() => {
    const resources = `${import.meta.env.BASE_URL}pdfjs/`
    const task = getDocument({
      // PDF.js transfers this buffer to its worker; retain the source for remounts.
      data: data.slice(),
      useSystemFonts: true,
      cMapUrl: `${resources}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${resources}standard_fonts/`,
      wasmUrl: `${resources}wasm/`,
    })
    let active = true
    void task.promise
      .then((value) => {
        if (active) {
          setDocument(value)
          setPage((current) => Math.min(current, value.numPages))
        }
      })
      .catch(() => {
        if (active)
          setError("PDF无法解码或所需字体资源不可用，请使用外部程序打开。")
      })
    return () => {
      active = false
      void task.destroy().catch(() => {})
    }
  }, [data])
  useEffect(() => {
    if (!viewport.current) return
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(100, entries[0].contentRect.width - 24))
    )
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!document || !canvas.current || !text.current) return
    renderingReady.current = false
    let active = true
    let rendering: RenderTask | undefined
    let layer: TextLayer | undefined
    const element = canvas.current,
      textElement = text.current
    setSelected("")
    setError("")
    void (async () => {
      const current = await document.getPage(page)
      if (!active) return
      const natural = current.getViewport({ scale: 1 })
      const scale = zoom || width / natural.width
      const view = current.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1
      element.width = Math.ceil(view.width * ratio)
      element.height = Math.ceil(view.height * ratio)
      element.style.width = `${view.width}px`
      element.style.height = `${view.height}px`
      textElement.style.width = `${view.width}px`
      textElement.style.height = `${view.height}px`
      textElement.style.setProperty("--scale-factor", String(scale))
      textElement.replaceChildren()
      rendering = current.render({
        canvas: element,
        viewport: view,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      })
      const content = await current.getTextContent()
      if (!active) return
      layer = new TextLayer({
        textContentSource: content,
        container: textElement,
        viewport: view,
      })
      await Promise.all([rendering.promise, layer.render()])
      if (active && viewport.current) {
        viewport.current.scrollTop = latestPosition.current?.scrollTop || 0
        viewport.current.scrollLeft = latestPosition.current?.scrollLeft || 0
        renderingReady.current = true
      }
    })().catch(() => {
      if (active) setError("PDF页面无法渲染，请使用外部程序打开。")
    })
    return () => {
      active = false
      renderingReady.current = false
      rendering?.cancel()
      layer?.cancel()
      element.width = 0
      element.height = 0
      textElement.replaceChildren()
    }
  }, [document, page, zoom, width])
  const change = (nextPage: number, nextZoom = zoom) => {
    setPage(nextPage)
    setZoom(nextZoom)
    onPosition({
      page: nextPage,
      zoom: nextZoom,
      ...(nextPage !== page ? { scrollTop: 0, scrollLeft: 0 } : {}),
    })
  }
  const selection = () => {
    const value = window.getSelection()
    setSelected(
      value?.anchorNode &&
        value.focusNode &&
        text.current?.contains(value.anchorNode) &&
        text.current.contains(value.focusNode)
        ? value.toString()
        : ""
    )
  }
  const quote = async () => {
    const request = new AbortController()
    quoteRequest.current?.abort()
    quoteRequest.current = request
    try {
      const result = await call<{ material: MaterialReference }>(
        "selection",
        {
          path,
          text: selected,
          selectionKind: "pdf",
          pageStart: page,
          pageEnd: page,
        },
        sessionId,
        request.signal
      )
      if (!request.signal.aborted) {
        onMaterial(result.material)
        setSelected("")
      }
    } catch (error) {
      if (!request.signal.aborted)
        setError(error instanceof Error ? error.message : "PDF选区引用失败。")
    } finally {
      if (quoteRequest.current === request) quoteRequest.current = null
    }
  }
  return (
    <div className="file-body">
      <div className="file-body-toolbar file-pdf-toolbar">
        <Button
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => change(page - 1)}
        >
          上一页
        </Button>
        <span className="file-page-number">
          第{page} / {document?.numPages || "—"}页
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!document || page >= document.numPages}
          onClick={() => change(page + 1)}
        >
          下一页
        </Button>
        <Button size="sm" variant="ghost" onClick={() => change(page, 0)}>
          适应宽度
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => change(page, Math.max(0.25, (zoom || 1) - 0.25))}
        >
          缩小
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => change(page, Math.min(4, (zoom || 1) + 0.25))}
        >
          放大
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected}
          onClick={() => void quote()}
        >
          引用选区
        </Button>
      </div>
      {error && (
        <p role="alert" className="file-message">
          {error}
        </p>
      )}
      <div
        className="file-pdf"
        ref={viewport}
        onScroll={(event) => {
          if (renderingReady.current)
            onPosition({
              scrollTop: event.currentTarget.scrollTop,
              scrollLeft: event.currentTarget.scrollLeft,
            })
        }}
      >
        <div className="file-pdf-page">
          <canvas ref={canvas} />
          <div
            className="textLayer"
            ref={text}
            onMouseUp={selection}
            onKeyUp={selection}
          />
        </div>
      </div>
    </div>
  )
}
