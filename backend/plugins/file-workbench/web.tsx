import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Folder,
  File,
  X,
  PanelRight,
  Maximize2,
  Minimize2,
  RefreshCw,
  Download,
  Quote,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PanelImperativeHandle } from "react-resizable-panels"
import { SourceViewer } from "./source-viewer"
import { ChangesViewer } from "./changes-viewer"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import {
  FileWorkbenchServiceContext,
  useFileWorkbenchService,
  fileWorkbenchService,
  type FileWorkbenchService,
} from "./file-service"
import {
  PluginPathContext,
  usePluginPaths,
} from "@/features/plugins/plugin-path-context"
import type { PluginWorkspaceProps } from "@/features/plugins/plugin-web"
import type { ResultRendererProps } from "@/features/extensions/result-renderers"
import type { MaterialReference } from "@/contracts/rpc.generated"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { rpcCall } from "@/lib/rpc/client"
import { pluginsChanged } from "@/features/plugins/plugin-service"
import type { PluginDescriptor } from "@/contracts/rpc.generated"
import type { InstalledEditor } from "@/contracts/desktop.generated"
import "./web.css"

export const id = "file-workbench"
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "本机文件操作未能完成，请重试。"
export function Page({ pluginId }: { pluginId: string }) {
  const [editors, setEditors] = useState<InstalledEditor[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await action()
    } catch (error) {
      setError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }
  const choose = async (path: string) => {
    const plugin = (await rpcCall("pluginList", {})).find(
      (plugin) => plugin.id === pluginId
    ) as PluginDescriptor | undefined
    if (!plugin) throw new Error("文件插件已不可用，请重新读取插件状态。")
    await rpcCall("pluginConfigure", {
      id: plugin.id,
      revision: plugin.revision,
      enabled: plugin.enabled,
      configuration: JSON.stringify({
        ...JSON.parse(plugin.configuration),
        editorPath: path,
      }),
    })
    pluginsChanged()
  }
  if (!isTauri()) return <p>外部编辑器由本机 Moon 桌面窗口选择和打开。</p>
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const installed = await invoke<InstalledEditor[]>("file_editors")
              setEditors(installed)
              if (!installed.length)
                setError("未检测到支持的已安装编辑器，可以手动选择已有程序。")
            })
          }
        >
          检测已安装编辑器
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const path = await invoke<string | null>("file_choose_editor")
              if (path) await choose(path)
            })
          }
        >
          选择编辑器程序
        </Button>
      </div>
      {editors.map((editor) => (
        <Button
          key={editor.path}
          variant="ghost"
          disabled={busy}
          title={editor.path}
          onClick={() => void run(() => choose(editor.path))}
        >
          使用 {editor.name}
        </Button>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
type FileInfo = {
  path: string
  requested: string
  name: string
  bytes: number
  version: string
  kind: "text" | "markdown" | "image" | "pdf" | "unsupported"
  mimeType: string
}
export type MediaPosition = {
  page?: number
  zoom?: number
  scrollTop?: number
  scrollLeft?: number
}
type FileTab = {
  info: FileInfo
  offset: number
  line: number
  scroll: number
  source: boolean
  media?: MediaPosition
}
type Layout = {
  changes?: boolean
  requestedChange?: string
  tabs: FileTab[]
  selected: string
  visible: boolean
  expanded: boolean
  width: number
}
const layouts = new Map<string, Layout>()
const nameOf = (path: string) => path.split(/[\\/]/).at(-1) || path
async function readComplete(
  info: FileInfo,
  sessionId: string,
  purpose: string,
  signal?: AbortSignal,
  call = fileWorkbenchService.call
) {
  if (
    !Number.isSafeInteger(info.bytes) ||
    info.bytes < 0 ||
    info.bytes > 32 * 1024 * 1024
  )
    throw new Error(
      "网页完整读取最多支持32MiB，请在本机外部程序打开或另存原文件。"
    )
  const chunks: Uint8Array[] = []
  let offset = 0
  do {
    const part = await call<{
      data: string
      next: number
      complete: boolean
      version: string
    }>(
      "bytes",
      { path: info.requested, offset, expected: info.version, purpose },
      sessionId,
      signal
    )
    const decoded = atob(part.data)
    chunks.push(
      Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    )
    if (part.complete) break
    if (part.next <= offset) throw new Error("文件读取未完成，未保存部分内容。")
    offset = part.next
  } while (!signal?.aborted)
  signal?.throwIfAborted()
  const bytes = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0)
  )
  let index = 0
  for (const chunk of chunks) {
    bytes.set(chunk, index)
    index += chunk.length
  }
  if (index !== info.bytes) throw new Error("文件读取不完整，未保存部分内容。")
  return bytes
}
function Tree({
  sessionId,
  path,
  onOpen,
}: {
  sessionId: string
  path: string
  onOpen: (path: string) => void
}) {
  const { call } = useFileWorkbenchService()
  const [result, setResult] = useState<{
    entries: {
      path: string
      name: string
      directory: boolean
      linked: boolean
    }[]
    truncated: boolean
  }>()
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    const read = () => {
      void call<typeof result>("tree", { path }, sessionId, controller.signal)
        .then((value) => {
          setResult(value)
          setError("")
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message)
        })
    }
    read()
    const timer = window.setInterval(read, 5000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [sessionId, path, call])
  return (
    <div className="file-tree-level">
      {error && <p role="alert">{error}</p>}
      {result?.entries.map((entry) => (
        <div key={entry.path}>
          <Button
            variant="ghost"
            size="sm"
            className="file-tree-entry"
            title={entry.path}
            aria-expanded={entry.directory ? open.has(entry.path) : undefined}
            onClick={() => {
              if (!entry.directory) onOpen(entry.path)
              else
                setOpen((previous) => {
                  const next = new Set(previous)
                  if (next.has(entry.path)) next.delete(entry.path)
                  else next.add(entry.path)
                  return next
                })
            }}
          >
            {entry.directory ? <Folder /> : <File />}
            <span>
              {entry.name}
              {entry.linked ? " ↗" : ""}
            </span>
          </Button>
          {entry.directory && open.has(entry.path) && (
            <Tree sessionId={sessionId} path={entry.path} onOpen={onOpen} />
          )}
        </div>
      ))}
      {result?.truncated && (
        <p role="status">本层只列出2000项，请在外部编辑器查看其余内容。</p>
      )}
      {result && !result.entries.length && !error && <p>此目录为空。</p>}
    </div>
  )
}
function FileBody({
  tab,
  sessionId,
  onUpdate,
  onMaterial,
}: {
  tab: FileTab
  sessionId: string
  onUpdate: (update: Partial<FileTab>) => void
  onMaterial: PluginWorkspaceProps["onMaterial"]
}) {
  const { call } = useFileWorkbenchService()
  const [text, setText] = useState<{
    content: string
    offset: number
    next: number
    nextLine: number
    complete: boolean
    line: number
  }>()
  const [blob, setBlob] = useState("")
  const [pdf, setPdf] = useState<Uint8Array>()
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const [selection, setSelection] = useState<object>()
  const [pending, setPending] = useState(false)
  const ownerKey = JSON.stringify([
    sessionId,
    tab.info.path,
    tab.info.requested,
    tab.info.version,
    tab.offset,
    tab.line,
    revision,
  ])
  const [owner, setOwner] = useState(ownerKey)
  if (owner !== ownerKey) {
    setOwner(ownerKey)
    setError("")
    setSelection(undefined)
    setText(undefined)
    setBlob("")
    setPdf(undefined)
    setPending(false)
  }
  const quoteRequest = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      quoteRequest.current?.abort()
    },
    [tab.source, tab.offset, tab.info.path, tab.info.version, revision]
  )
  const rendered = useRef<HTMLDivElement>(null)
  const latest = useRef(tab)
  useLayoutEffect(() => {
    latest.current = tab
  }, [tab])
  const updateTab = useEffectEvent(onUpdate)
  useEffect(() => {
    const controller = new AbortController()
    let url = ""
    void (async () => {
      const info = await call<FileInfo>(
        "info",
        { path: tab.info.requested },
        sessionId,
        controller.signal
      )
      if (info.kind === "text" || info.kind === "markdown") {
        const page = await call<NonNullable<typeof text>>(
          "text",
          {
            path: info.requested,
            ...(info.version === tab.info.version
              ? { offset: tab.offset, line: tab.line }
              : { atLine: tab.line }),
            expected: info.version,
          },
          sessionId,
          controller.signal
        )
        if (!controller.signal.aborted) {
          setText(page)
          if (info.version !== tab.info.version)
            updateTab({ info, offset: page.offset, line: page.line })
        }
      } else if (info.kind === "image" || info.kind === "pdf") {
        const bytes = await readComplete(
          info,
          sessionId,
          "preview",
          controller.signal,
          call
        )
        if (!controller.signal.aborted) {
          if (info.kind === "pdf") {
            setPdf(bytes)
          } else {
            url = URL.createObjectURL(
              new Blob([bytes], { type: info.mimeType })
            )
            setBlob(url)
          }
          if (info.version !== tab.info.version) updateTab({ info })
        }
      } else if (info.version !== tab.info.version) {
        updateTab({ info })
      }
    })().catch((error) => {
      if (!controller.signal.aborted) setError(error.message)
    })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [
    sessionId,
    tab.info.requested,
    tab.info.path,
    tab.info.version,
    tab.offset,
    tab.line,
    revision,
    call,
  ])
  useEffect(() => {
    const controller = new AbortController()
    let checking = false
    const timer = window.setInterval(() => {
      if (checking || document.hidden) return
      checking = true
      void call<{ version: string }>(
        "state",
        { path: tab.info.requested },
        sessionId,
        controller.signal
      )
        .then((state) => {
          if (state.version !== latest.current.info.version)
            setRevision((value) => value + 1)
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message)
        })
        .finally(() => {
          checking = false
        })
    }, 2000)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [sessionId, tab.info.requested, call])
  useLayoutEffect(() => {
    if (text) {
      if (rendered.current) rendered.current.scrollTop = tab.scroll
    }
  }, [text, tab.scroll, tab.source])
  const selectRendered = () => {
    const selected = window.getSelection()
    if (
      !selected?.anchorNode ||
      !selected.focusNode ||
      !rendered.current?.contains(selected.anchorNode) ||
      !rendered.current.contains(selected.focusNode) ||
      !selected.toString()
    ) {
      setSelection(undefined)
      return
    }
    setSelection({
      path: tab.info.path,
      text: selected.toString(),
      selectionKind: "markdown",
    })
  }
  const quote = async () => {
    if (!selection) return
    const request = new AbortController()
    quoteRequest.current?.abort()
    quoteRequest.current = request
    setPending(true)
    setError("")
    try {
      const value = await call<{ material: MaterialReference }>(
        "selection",
        selection,
        sessionId,
        request.signal
      )
      if (request.signal.aborted) return
      onMaterial(value.material)
      setSelection(undefined)
    } catch (error) {
      if (!request.signal.aborted)
        setError(error instanceof Error ? error.message : "选区引用失败。")
    } finally {
      if (quoteRequest.current === request) {
        quoteRequest.current = null
        setPending(false)
      }
    }
  }
  return (
    <div className="file-body">
      <div className="file-body-toolbar">
        <span>
          {tab.info.name} · {tab.info.bytes.toLocaleString()} 字节
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRevision((value) => value + 1)}
          aria-label="重新读取当前文件"
        >
          <RefreshCw />
        </Button>
        {tab.info.kind === "markdown" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelection(undefined)
              onUpdate({ source: !tab.source })
            }}
          >
            {tab.source ? "渲染" : "源码"}
          </Button>
        )}
        {(tab.info.kind === "text" || tab.info.kind === "markdown") && (
          <Button
            variant="outline"
            size="sm"
            disabled={!selection || pending}
            onClick={() => void quote()}
          >
            <Quote />
            引用选区
          </Button>
        )}
      </div>
      {error && (
        <p className="file-message" role="alert">
          {error}
        </p>
      )}
      {text && (
        <p className="file-page-caption">
          当前文件 · 从第{text.line}行开始
          {text.complete && tab.offset === 0 ? " · 全文" : " · 当前页，非全文"}
        </p>
      )}
      {text &&
        (tab.info.kind !== "markdown" || tab.source ? (
          <SourceViewer
            content={text.content}
            name={tab.info.name}
            line={text.line}
            scroll={tab.scroll}
            onScroll={(scroll) => onUpdate({ scroll })}
            onSelect={(selection) =>
              setSelection(
                selection
                  ? {
                      ...selection,
                      path: tab.info.path,
                      selectionKind: "source",
                    }
                  : undefined
              )
            }
          />
        ) : (
          <div
            className="file-markdown"
            ref={rendered}
            onMouseUp={selectRendered}
            onKeyUp={selectRendered}
            onScroll={(event) =>
              onUpdate({ scroll: event.currentTarget.scrollTop })
            }
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {text.content}
            </ReactMarkdown>
          </div>
        ))}
      {text && (
        <div className="file-body-toolbar">
          <Button
            variant="ghost"
            size="sm"
            disabled={!tab.offset}
            onClick={() => onUpdate({ offset: 0, line: 1, scroll: 0 })}
          >
            回到开头
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={text.complete}
            onClick={() =>
              onUpdate({ offset: text.next, line: text.nextLine, scroll: 0 })
            }
          >
            下一页
          </Button>
        </div>
      )}
      {blob && tab.info.kind === "image" && (
        <ImageBody
          key={blob}
          url={blob}
          name={tab.info.name}
          position={tab.media}
          onPosition={(media) => onUpdate({ media })}
        />
      )}
      {pdf && tab.info.kind === "pdf" && (
        <PdfBody
          data={pdf}
          path={tab.info.path}
          sessionId={sessionId}
          onMaterial={onMaterial}
          position={tab.media}
          onPosition={(media) => onUpdate({ media })}
        />
      )}
      {tab.info.kind === "unsupported" && (
        <p className="file-message">
          此格式不提供内容预览，可下载原文件或在本机使用关联程序打开。
        </p>
      )}
      {!text && !blob && !pdf && !error && tab.info.kind !== "unsupported" && (
        <p className="file-message" role="status">
          正在读取当前文件…
        </p>
      )}
    </div>
  )
}
export function ImageBody({
  url,
  name,
  position,
  onPosition,
}: {
  url: string
  name: string
  position?: MediaPosition
  onPosition: (position: MediaPosition) => void
}) {
  const [zoom, setZoom] = useState(position?.zoom || 0)
  const [naturalWidth, setNaturalWidth] = useState(0)
  const [failed, setFailed] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const latestPosition = useRef(position)
  useLayoutEffect(() => {
    latestPosition.current = position
  }, [position])
  useLayoutEffect(() => {
    if (!naturalWidth || !viewport.current) return
    viewport.current.scrollTop = latestPosition.current?.scrollTop || 0
    viewport.current.scrollLeft = latestPosition.current?.scrollLeft || 0
  }, [naturalWidth])
  const changeZoom = (value: number) => {
    setZoom(value)
    onPosition({ zoom: value })
  }
  return (
    <div className="file-body">
      <div className="file-body-toolbar">
        <Button size="sm" variant="ghost" onClick={() => changeZoom(0)}>
          适应宽度
        </Button>
        <Button size="sm" variant="ghost" onClick={() => changeZoom(1)}>
          100%
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => changeZoom(Math.max(0.25, (zoom || 1) - 0.25))}
        >
          缩小
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => changeZoom(Math.min(4, (zoom || 1) + 0.25))}
        >
          放大
        </Button>
        <span>{zoom ? `${Math.round(zoom * 100)}%` : "适应宽度"}</span>
      </div>
      {failed ? (
        <p className="file-message" role="alert">
          图片无法解码，请下载原文件或在外部程序打开。
        </p>
      ) : (
        <div
          className="file-image"
          ref={viewport}
          onScroll={(event) =>
            onPosition({
              scrollTop: event.currentTarget.scrollTop,
              scrollLeft: event.currentTarget.scrollLeft,
            })
          }
        >
          <img
            src={url}
            alt={name}
            onLoad={(event) =>
              setNaturalWidth(event.currentTarget.naturalWidth)
            }
            onError={() => setFailed(true)}
            style={
              zoom && naturalWidth
                ? { maxWidth: "none", width: naturalWidth * zoom }
                : undefined
            }
          />
        </div>
      )}
    </div>
  )
}
function PdfBody(props: {
  data: Uint8Array
  path: string
  sessionId: string
  onMaterial: PluginWorkspaceProps["onMaterial"]
  position?: MediaPosition
  onPosition: (position: MediaPosition) => void
}) {
  const [Component, setComponent] =
    useState<React.ComponentType<typeof props>>()
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    void import("./pdf-viewer")
      .then((module) => {
        if (active) setComponent(() => module.PdfViewer)
      })
      .catch(() => {
        if (active) setError("PDF查看器未能加载，请重新打开文件。")
      })
    return () => {
      active = false
    }
  }, [])
  return Component ? (
    <Component {...props} />
  ) : (
    <p role="status">{error || "正在加载PDF查看器…"}</p>
  )
}
export function Workspace(
  props: PluginWorkspaceProps & { service?: FileWorkbenchService }
) {
  return (
    <FileWorkbenchServiceContext value={props.service || fileWorkbenchService}>
      <WorkspaceContent {...props} />
    </FileWorkbenchServiceContext>
  )
}
function WorkspaceContent({
  sessionId,
  cwd,
  active,
  onMaterial,
  children,
}: PluginWorkspaceProps) {
  const { call, desktop } = useFileWorkbenchService()
  const [foreground, setForeground] = useState(() => !document.hidden)
  useEffect(() => {
    const changed = () => setForeground(!document.hidden)
    document.addEventListener("visibilitychange", changed)
    return () => document.removeEventListener("visibilitychange", changed)
  }, [])
  const visibleConsumer = active && foreground
  const [layout, setLayout] = useState<Layout>(
    () =>
      layouts.get(sessionId) || {
        tabs: [],
        selected: "",
        visible: false,
        expanded: false,
        width: 420,
      }
  )
  const [editorPath, setEditorPath] = useState("")
  const filePanel = useRef<PanelImperativeHandle>(null)
  useEffect(() => {
    if (!desktop || !active) return
    const controller = new AbortController()
    const read = () => {
      void desktop
        .editorPath(controller.signal)
        .then((path) => {
          if (!controller.signal.aborted) setEditorPath(path)
        })
        .catch(() => {})
    }
    read()
    window.addEventListener("moon:plugins-changed", read)
    return () => {
      controller.abort()
      window.removeEventListener("moon:plugins-changed", read)
    }
  }, [desktop, active])
  const [error, setError] = useState("")
  const [downloading, setDownloading] = useState(false)
  const [notice, setNotice] = useState("")
  const downloadRequest = useRef<AbortController | null>(null)
  const reads = useRef(new Set<AbortController>())
  const mounted = useRef(true)
  const update = useCallback(
    (action: (previous: Layout) => Layout) => {
      setLayout((previous) => {
        const next = action(previous)
        layouts.set(sessionId, next)
        return next
      })
    },
    [sessionId]
  )
  useEffect(() => {
    mounted.current = true
    const owned = reads.current
    return () => {
      mounted.current = false
      for (const request of owned) request.abort()
      downloadRequest.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!visibleConsumer) {
      for (const request of reads.current) request.abort()
      downloadRequest.current?.abort()
    }
  }, [visibleConsumer])
  const openPath = useCallback(
    async (path: string) => {
      if (!active) return
      const request = new AbortController()
      reads.current.add(request)
      try {
        const info = await call<FileInfo>(
          "info",
          { path },
          sessionId,
          request.signal
        )
        if (!mounted.current || request.signal.aborted) return
        update((previous) => ({
          ...previous,
          visible: true,
          changes: false,
          selected: info.path,
          tabs: previous.tabs.some((tab) => tab.info.path === info.path)
            ? previous.tabs.map((tab) =>
                tab.info.path === info.path ? { ...tab, info } : tab
              )
            : [
                ...previous.tabs,
                { info, offset: 0, line: 1, scroll: 0, source: false },
              ],
        }))
      } catch (error) {
        if (!request.signal.aborted) throw error
      } finally {
        reads.current.delete(request)
      }
    },
    [sessionId, update, call, active]
  )
  const reference = useCallback(
    async (path: string) => {
      if (!active) return
      const request = new AbortController()
      reads.current.add(request)
      try {
        const value = await call<{ material: MaterialReference }>(
          "reference",
          { path },
          sessionId,
          request.signal
        )
        if (mounted.current && !request.signal.aborted)
          onMaterial(value.material)
      } finally {
        reads.current.delete(request)
      }
    },
    [sessionId, onMaterial, call, active]
  )
  const download = useCallback(
    async (path: string) => {
      if (!active) return
      if (downloadRequest.current)
        throw new Error("已有文件正在读取，请完成或取消后再下载。")
      const request = new AbortController()
      downloadRequest.current = request
      setDownloading(true)
      setNotice("")
      setError("")
      try {
        const info = await call<FileInfo>(
          "info",
          { path },
          sessionId,
          request.signal
        )
        if (desktop) {
          const result = await desktop.exportFile(info.requested, info.name)
          if (mounted.current)
            setNotice(result ? "原文件已另存。" : "已取消另存。")
          return
        }
        const bytes = await readComplete(
          info,
          sessionId,
          "download",
          request.signal,
          call
        )
        if (!mounted.current || request.signal.aborted) return
        const url = URL.createObjectURL(
          new Blob([bytes], { type: "application/octet-stream" })
        )
        const link = document.createElement("a")
        link.href = url
        link.download = info.name
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setNotice("原文件已完整读取，已交给浏览器下载。")
      } catch (error) {
        if (request.signal.aborted) {
          if (mounted.current) setNotice("已取消下载。")
          return
        }
        throw error
      } finally {
        downloadRequest.current = null
        if (mounted.current) setDownloading(false)
      }
    },
    [sessionId, call, desktop, active]
  )
  useEffect(() => {
    if (!cwd || !active) return
    const controller = new AbortController()
    const token = crypto.randomUUID()
    const generation =
      (Number(sessionStorage.getItem("moon-file-view-generation")) || 0) + 1
    sessionStorage.setItem("moon-file-view-generation", String(generation))
    let reading = false
    const follow = () => {
      if (reading) return
      reading = true
      void call<{ requests: { path: string; token: string }[] }>(
        "view",
        { token, generation, active: visibleConsumer },
        sessionId,
        controller.signal
      )
        .then((result) => {
          if (!controller.signal.aborted && visibleConsumer)
            for (const request of result.requests)
              if (request.token === token)
                void openPath(request.path).catch((error) =>
                  setError(error.message)
                )
        })
        .catch(() => {})
        .finally(() => {
          reading = false
        })
    }
    follow()
    const timer = visibleConsumer ? window.setInterval(follow, 2000) : undefined
    return () => {
      clearInterval(timer)
      controller.abort()
      void call("view", { token, generation, active: false }, sessionId).catch(
        () => {}
      )
    }
  }, [sessionId, cwd, active, visibleConsumer, openPath, call])
  const tab = layout.tabs.find((tab) => tab.info.path === layout.selected)
  const pane = (
    <aside className="file-rail" aria-label="文件工作栏">
      <div className="file-rail-header">
        <strong>文件</strong>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              update((previous) => ({
                ...previous,
                changes: !previous.changes,
              }))
            }
          >
            {layout.changes ? "文件预览" : "变更"}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={layout.expanded ? "还原文件栏" : "展开文件栏"}
            onClick={() =>
              update((previous) => ({
                ...previous,
                expanded: !previous.expanded,
              }))
            }
          >
            {layout.expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="返回会话并收起文件栏"
            onClick={() =>
              update((previous) => ({
                ...previous,
                visible: false,
                expanded: false,
              }))
            }
          >
            <X />
          </Button>
        </div>
      </div>
      {error && (
        <p className="file-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="file-message" role="status">
          {notice}
        </p>
      )}
      {downloading && (
        <div className="file-body-toolbar">
          <span role="status">正在读取完整原文件…</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!!desktop}
            onClick={() => downloadRequest.current?.abort()}
          >
            取消读取
          </Button>
        </div>
      )}
      {!layout.changes && (
        <div className="file-tabs" role="tablist">
          {layout.tabs.map((item) => (
            <div key={item.info.path} className="file-tab">
              <Button
                variant="ghost"
                size="sm"
                role="tab"
                aria-selected={item.info.path === layout.selected}
                title={item.info.path}
                onClick={() =>
                  update((previous) => ({
                    ...previous,
                    selected: item.info.path,
                  }))
                }
              >
                {nameOf(item.info.path)}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`关闭${item.info.name}`}
                onClick={() =>
                  update((previous) => {
                    const tabs = previous.tabs.filter((tab) => tab !== item)
                    return {
                      ...previous,
                      tabs,
                      selected:
                        previous.selected === item.info.path
                          ? tabs.at(-1)?.info.path || ""
                          : previous.selected,
                    }
                  })
                }
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}
      {layout.changes ? (
        <ChangesViewer
          key={layout.requestedChange || "changes"}
          sessionId={sessionId}
          requested={layout.requestedChange}
          onOpen={openPath}
        />
      ) : (
        <div className="file-rail-main">
          <nav className="file-tree" aria-label="会话文件目录">
            <Tree
              sessionId={sessionId}
              path={cwd}
              onOpen={(path) =>
                void openPath(path).catch((error) => setError(error.message))
              }
            />
          </nav>
          <div className="file-viewer">
            {tab ? (
              <>
                <div className="file-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void reference(tab.info.requested).catch((error) =>
                        setError(error.message)
                      )
                    }
                  >
                    <Quote />
                    引用文件路径
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void download(tab.info.requested).catch((error) =>
                        setError(error.message)
                      )
                    }
                  >
                    <Download />
                    下载原文件
                  </Button>
                  {desktop && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void desktop
                          .open(
                            tab.info.requested,
                            ["text", "markdown"].includes(tab.info.kind)
                              ? editorPath || null
                              : null
                          )
                          .catch((failure) =>
                            setError(
                              typeof failure === "string"
                                ? failure
                                : failure instanceof Error
                                  ? failure.message
                                  : "外部程序未能打开，请重新选择程序或重试。"
                            )
                          )
                      }
                    >
                      外部打开
                    </Button>
                  )}
                </div>
                <FileBody
                  key={tab.info.path}
                  tab={tab}
                  sessionId={sessionId}
                  onUpdate={(changes) =>
                    update((previous) => ({
                      ...previous,
                      selected:
                        changes.info && previous.selected === tab.info.path
                          ? changes.info.path
                          : previous.selected,
                      tabs: previous.tabs
                        .filter(
                          (item) =>
                            !changes.info ||
                            changes.info.path === tab.info.path ||
                            item.info.path !== changes.info.path
                        )
                        .map((item) =>
                          item.info.path === tab.info.path
                            ? {
                                ...item,
                                ...changes,
                                media: changes.media
                                  ? { ...item.media, ...changes.media }
                                  : item.media,
                              }
                            : item
                        ),
                    }))
                  }
                  onMaterial={onMaterial}
                />
              </>
            ) : (
              <p className="file-message">
                从目录选择文件，或点击会话中的文件路径。
              </p>
            )}
          </div>
        </div>
      )}
    </aside>
  )
  return (
    <PluginPathContext
      value={
        active
          ? {
              openPath,
              reference,
              download,
              openChange: (tool) =>
                update((previous) => ({
                  ...previous,
                  visible: true,
                  changes: true,
                  requestedChange: tool.occurrenceId || tool.id,
                })),
            }
          : null
      }
    >
      <div
        className="file-workspace"
        data-expanded={active && layout.expanded && layout.visible}
      >
        {active && !layout.visible && (
          <div className="file-workspace-actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={!cwd}
              onClick={() =>
                update((previous) => ({
                  ...previous,
                  visible: !previous.visible,
                  expanded: false,
                }))
              }
            >
              <PanelRight />
              {layout.visible ? "收起文件栏" : "文件"}
            </Button>
          </div>
        )}
        <ResizablePanelGroup
          orientation="horizontal"
          onLayoutChanged={(_sizes, meta) => {
            if (!meta.isUserInteraction) return
            const width = filePanel.current?.getSize().inPixels
            if (width && width > 0)
              update((previous) =>
                Math.abs(previous.width - width) < 1
                  ? previous
                  : { ...previous, width }
              )
          }}
        >
          <ResizablePanel className="file-chat" minSize="250px">
            {children}
          </ResizablePanel>
          {visibleConsumer && layout.visible && !layout.expanded && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                panelRef={filePanel}
                defaultSize={`${layout.width}px`}
                minSize="280px"
              >
                {pane}
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        {visibleConsumer && layout.visible && layout.expanded && (
          <div className="file-expanded">{pane}</div>
        )}
      </div>
    </PluginPathContext>
  )
}
export function FileLink({ payload }: ResultRendererProps) {
  const paths = usePluginPaths()
  const [error, setError] = useState("")
  const value = payload as { path?: string; name?: string }
  if (!value || typeof value.path !== "string") return null
  const path = value.path
  const run = (action: () => Promise<void>) => {
    setError("")
    void action().catch((error) => setError(error.message))
  }
  return (
    <div className="file-result-card">
      <strong>{value.name || nameOf(path)}</strong>
      <span title={path}>{path}</span>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!paths}
          onClick={() => run(() => paths!.openPath(path))}
        >
          打开当前文件
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!paths}
          onClick={() => run(() => paths!.reference(path))}
        >
          引用
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!paths}
          onClick={() => run(() => paths!.download(path))}
        >
          下载
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
export const results = [
  { kind: "file-link", version: 1, persistent: true, component: FileLink },
]
