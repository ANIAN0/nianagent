import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  File,
  FileDiff,
  RefreshCw,
  Download,
  Quote,
  ChevronsDownUp,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { notifyToast } from "@/components/ui/notification-toast"
import { Field, FieldLabel } from "@/components/ui/field"
import { SourceViewer } from "./source-viewer"
import { ChangesViewer } from "./changes-viewer"
import {
  FileWorkbenchServiceContext,
  useFileWorkbenchService,
  fileWorkbenchService,
  type FileWorkbenchService,
} from "./file-service"
import type {
  PluginContext,
  PluginDeliveryProps,
  PluginWebModule,
} from "@/features/plugins/plugin-api"
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
    : typeof error === "string" && error.trim()
      ? error
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "本机文件操作未能完成，请重试。"
const parsePluginConfig = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw || "{}")
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function Page({ pluginId }: { pluginId: string }) {
  const [editors, setEditors] = useState<InstalledEditor[]>([])
  const [savedPath, setSavedPath] = useState("")
  const [draftPath, setDraftPath] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [loadRevision, setLoadRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    void rpcCall("pluginList", {}, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        const plugin = (list as PluginDescriptor[]).find(
          (item) => item.id === pluginId
        )
        const config = plugin ? parsePluginConfig(plugin.configuration) : {}
        const current =
          typeof config.editorPath === "string" ? config.editorPath : ""
        setSavedPath(current)
        setDraftPath(current)
        setLoaded(true)
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(messageOf(err))
        }
      })
    return () => controller.abort()
  }, [pluginId, loadRevision])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await action()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }
  const saveEditorPath = async (path: string) => {
    const plugin = (await rpcCall("pluginList", {})).find(
      (plugin) => plugin.id === pluginId
    ) as PluginDescriptor | undefined
    if (!plugin) throw new Error("文件插件已不可用，请重新读取插件状态。")
    await rpcCall("pluginConfigure", {
      id: plugin.id,
      revision: plugin.revision,
      enabled: plugin.enabled,
      configuration: JSON.stringify({
        ...parsePluginConfig(plugin.configuration),
        editorPath: path,
      }),
    })
    setSavedPath(path)
    setDraftPath(path)
    notifyToast(path ? "外部编辑器已更新" : "已恢复系统默认程序", {
      tone: "success",
    })
    pluginsChanged()
  }
  const dirty = loaded && draftPath.trim() !== savedPath
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-label="外部编辑器设置">
      {error && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!loaded ? (
        error ? (
          <Button
            variant="outline"
            className="self-start"
            onClick={() => {
              setError("")
              setLoadRevision((value) => value + 1)
            }}
          >
            重新读取
          </Button>
        ) : (
          <Skeleton
            role="status"
            aria-label="正在读取编辑器设置"
            className="h-36 w-full rounded-xl"
          />
        )
      ) : (
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-4">
          <Field>
            <FieldLabel htmlFor="file-workbench-editor-path">
              外部编辑器路径
            </FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="file-workbench-editor-path"
                className="min-w-0 flex-[1_1_14rem] font-mono text-xs"
                value={draftPath}
                placeholder="留空则使用系统默认关联程序"
                disabled={busy}
                onChange={(event) => setDraftPath(event.target.value)}
              />
              <Button
                className="text-xs"
                disabled={busy || !dirty}
                onClick={() => void run(() => saveEditorPath(draftPath.trim()))}
              >
                保存
              </Button>
              {savedPath && (
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={busy}
                  onClick={() => void run(() => saveEditorPath(""))}
                >
                  恢复默认
                </Button>
              )}
            </div>
          </Field>
          {isTauri() ? (
            <div className="flex flex-col gap-3 border-t pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const installed =
                        await invoke<InstalledEditor[]>("file_editors")
                      setEditors(installed)
                      if (!installed.length) {
                        notifyToast("未检测到常见编辑器，可手动选择程序", {
                          tone: "warning",
                        })
                      }
                    })
                  }
                >
                  <Search className="size-3.5" />
                  检测已安装编辑器
                </Button>
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const path = await invoke<string | null>(
                        "file_choose_editor"
                      )
                      if (path) await saveEditorPath(path)
                    })
                  }
                >
                  <FolderOpen className="size-3.5" />
                  浏览程序文件
                </Button>
              </div>
              {editors.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {editors.map((editor) => {
                    const active = savedPath === editor.path
                    return (
                      <Button
                        key={editor.path}
                        variant={active ? "secondary" : "outline"}
                        className="text-xs"
                        disabled={busy}
                        title={editor.path}
                        onClick={() =>
                          void run(() => saveEditorPath(editor.path))
                        }
                      >
                        {active && <Check className="size-3.5 text-primary" />}
                        {editor.name}
                      </Button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              自动检测与浏览程序仅在桌面端可用。
            </p>
          )}
        </section>
      )}
    </div>
  )
}
type FileInfo = {
  path: string
  requested: string
  displayPath?: string
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
type Layout = { tab?: FileTab }
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
  refreshTick,
  onOpen,
}: {
  sessionId: string
  path: string
  refreshTick: number
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
    void call<typeof result>("tree", { path }, sessionId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setResult(value)
        setError("")
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(messageOf(error))
      })
    return () => {
      controller.abort()
    }
  }, [sessionId, path, refreshTick, call])
  return (
    <div className="file-tree-level">
      {error && (
        <p className="file-message" role="alert">
          {error}
        </p>
      )}
      {!result && !error && (
        <p className="file-message" role="status">
          正在读取目录…
        </p>
      )}
      {result?.entries.length === 0 && !error && (
        <p className="file-message">此目录为空。</p>
      )}
      {result?.entries.map((entry) => {
        const expanded = entry.directory && open.has(entry.path)
        return (
          <div key={entry.path}>
            <Button
              variant="ghost"
              size="sm"
              className="file-tree-entry"
              title={entry.path}
              aria-expanded={entry.directory ? expanded : undefined}
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
              {entry.directory ? (
                <>
                  {expanded ? (
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {expanded ? (
                    <FolderOpen className="size-4 shrink-0" />
                  ) : (
                    <Folder className="size-4 shrink-0" />
                  )}
                </>
              ) : (
                <>
                  <span className="size-3.5 shrink-0" aria-hidden />
                  <File className="size-4 shrink-0 text-muted-foreground" />
                </>
              )}
              <span>
                {entry.name}
                {entry.linked ? " ↗" : ""}
              </span>
            </Button>
            {expanded && (
              <Tree
                sessionId={sessionId}
                path={entry.path}
                refreshTick={refreshTick}
                onOpen={onOpen}
              />
            )}
          </div>
        )
      })}
      {result?.truncated && (
        <p role="status">本层只列出2000项，请在外部编辑器查看其余内容。</p>
      )}
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
  onMaterial: PluginContext["reference"]
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
    const checkState = () => {
      if (checking || document.hidden || controller.signal.aborted) return
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
    }
    const onVisible = () => {
      if (!document.hidden) checkState()
    }
    const timer = window.setInterval(checkState, 5000)
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", checkState)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", checkState)
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
  onMaterial: PluginContext["reference"]
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
function useSessionFileService(
  props: PluginContext & { service?: FileWorkbenchService }
) {
  const call = props.call
  return useMemo(
    () =>
      props.service || {
        ...fileWorkbenchService,
        call: async <T,>(
          operation: string,
          input: object,
          _sessionId: string,
          signal?: AbortSignal
        ) => (await call<{ value: T }>(operation, input, signal)).value,
      },
    [props.service, call]
  )
}

export function FileDirectory(
  props: PluginContext & { service?: FileWorkbenchService }
) {
  const [refreshTick, setRefreshTick] = useState(0)
  const [collapseTick, setCollapseTick] = useState(0)
  const rootName = nameOf(props.cwd) || props.cwd
  return (
    <FileWorkbenchServiceContext value={useSessionFileService(props)}>
      <section className="file-rail" aria-label="工作区文件">
        <div className="file-body-toolbar">
          <span
            className="truncate font-medium text-foreground"
            title={props.cwd}
          >
            {rootName}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="刷新目录"
            title="刷新目录"
            onClick={() => setRefreshTick((value) => value + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="收起全部目录"
            title="收起全部目录"
            onClick={() => setCollapseTick((value) => value + 1)}
          >
            <ChevronsDownUp className="size-3.5" />
          </Button>
        </div>
        <nav className="file-directory" aria-label="目录树">
          <Tree
            key={collapseTick}
            sessionId={props.sessionId}
            path={props.cwd}
            refreshTick={refreshTick}
            onOpen={(path) => props.openTab("preview", { path })}
          />
        </nav>
      </section>
    </FileWorkbenchServiceContext>
  )
}
export function FileChanges(
  props: PluginContext & { service?: FileWorkbenchService }
) {
  const payload = props.payload as { occurrenceId?: string } | undefined
  const files = useSessionFileService(props)
  return (
    <FileWorkbenchServiceContext value={files}>
      <ChangesViewer
        key={payload?.occurrenceId || "git"}
        sessionId={props.sessionId}
        requested={payload?.occurrenceId}
        onOpen={async (path) => {
          await files.call("info", { path }, props.sessionId, props.signal)
          if (!props.signal.aborted) props.openTab("preview", { path })
        }}
      />
    </FileWorkbenchServiceContext>
  )
}
export function FilePanel(
  props: PluginContext & { service?: FileWorkbenchService }
) {
  return (
    <FileWorkbenchServiceContext value={useSessionFileService(props)}>
      <FilePanelContent {...props} />
    </FileWorkbenchServiceContext>
  )
}
function FilePanelContent({
  sessionId,
  resource,
  active,
  reference: onMaterial,
  payload,
}: PluginContext) {
  const { call, desktop } = useFileWorkbenchService()
  const [foreground, setForeground] = useState(() => !document.hidden)
  useEffect(() => {
    const changed = () => setForeground(!document.hidden)
    document.addEventListener("visibilitychange", changed)
    return () => document.removeEventListener("visibilitychange", changed)
  }, [])
  const visibleConsumer = active && foreground
  const path =
    resource || (payload as { path?: string } | undefined)?.path || ""
  const cacheKey = JSON.stringify([sessionId, path])
  const [layout, setLayout] = useState<Layout>(
    () => layouts.get(cacheKey) || {}
  )
  const [editorPath, setEditorPath] = useState("")
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
        layouts.set(cacheKey, next)
        return next
      })
    },
    [cacheKey]
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
  useEffect(() => {
    if (!visibleConsumer || !path) return
    const request = new AbortController()
    const owned = reads.current
    owned.add(request)
    void call<FileInfo>("info", { path }, sessionId, request.signal)
      .then((info) => {
        if (request.signal.aborted) return
        setError("")
        update((previous) => ({
          tab:
            previous.tab?.info.path === info.path
              ? { ...previous.tab, info }
              : { info, offset: 0, line: 1, scroll: 0, source: false },
        }))
      })
      .catch((error) => {
        if (!request.signal.aborted) setError(messageOf(error))
      })
      .finally(() => owned.delete(request))
    return () => request.abort()
  }, [path, sessionId, update, call, visibleConsumer])
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
  const tab = layout.tab
  return (
    <section className="file-rail" aria-label="文件预览">
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
      <div className="file-viewer">
        {tab ? (
          <>
            <div
              className="truncate border-b px-3 py-1.5 font-mono text-xs text-muted-foreground"
              title={tab.info.path}
            >
              {tab.info.displayPath || tab.info.name}
            </div>
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
                  tab: previous.tab
                    ? {
                        ...previous.tab,
                        ...changes,
                        media: changes.media
                          ? { ...previous.tab.media, ...changes.media }
                          : previous.tab.media,
                      }
                    : previous.tab,
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
    </section>
  )
}

/** Nonvisual subscription, disposed by the host independently of tab mounting. */
function connectSession(context: PluginContext) {
  if (!context.active || !context.cwd) return
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, context.signal])
  let view:
    | { token: string; generation: number; reading: boolean; notified: boolean }
    | undefined
  const follow = async () => {
    const current = view
    if (!current || current.reading || signal.aborted || document.hidden) return
    current.reading = true
    try {
      const { value } = await context.call<{
        value: { requests: { path: string; token: string }[] }
      }>(
        "view",
        { token: current.token, generation: current.generation, active: true },
        signal
      )
      if (!signal.aborted && !document.hidden && view === current)
        for (const request of value.requests)
          if (request.token === current.token)
            context.openTab("preview", { path: request.path })
    } catch {
      /* An inactive client must not replay an old open request. */
    } finally {
      current.reading = false
      if (current.notified && view === current) {
        current.notified = false
        void follow()
      }
    }
  }
  const release = () => {
    const current = view
    view = undefined
    if (current)
      void context
        .call(
          "view",
          {
            token: current.token,
            generation: current.generation,
            active: false,
          },
          new AbortController().signal
        )
        .catch(() => {})
  }
  const visibilityChanged = () => {
    release()
    if (!document.hidden && !signal.aborted) {
      view = {
        token: crypto.randomUUID(),
        generation: ++viewGeneration,
        reading: false,
        notified: false,
      }
      void follow()
    }
  }
  const offEvent = context.onEvent?.("open-requested", (payload) => {
    const targetSession = (payload as { sessionId?: string } | undefined)
      ?.sessionId
    if (!view || (targetSession && targetSession !== context.sessionId)) return
    if (view.reading) view.notified = true
    else void follow()
  })
  visibilityChanged()
  // Desktop events wake the reader, but the host still requires a live lease.
  const timer = window.setInterval(
    () => void follow(),
    isTauri() && offEvent ? 8000 : 4000
  )
  document.addEventListener("visibilitychange", visibilityChanged)
  return () => {
    controller.abort()
    offEvent?.()
    clearInterval(timer)
    document.removeEventListener("visibilitychange", visibilityChanged)
    release()
  }
}
let viewGeneration = Date.now()
export function FileDelivery({
  delivery,
  deliveries = [delivery],
  context,
}: PluginDeliveryProps) {
  const files = new Map<
    string,
    { record: typeof delivery; path: string; name: string }
  >()
  for (const record of deliveries) {
    const value = JSON.parse(record.payload) as { path: string; name?: string }
    if (typeof value.path !== "string") throw new Error("交付文件路径无效。")
    files.set(value.path, {
      record,
      path: value.path,
      name: value.name || nameOf(value.path),
    })
  }
  return (
    <section className="file-result-card">
      <strong>
        {delivery.kind === "file-change" ? "变更文件" : "交付文件"}
      </strong>
      {[...files.values()].map(({ record, path, name }) => (
        <div
          key={path}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span title={path}>{name}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              context.openTab(
                record.kind === "file-change" ? "changes" : "preview",
                record.kind === "file-change"
                  ? { changes: true, occurrenceId: record.originId }
                  : { path }
              )
            }
          >
            {record.kind === "file-change" ? "查看变更" : "打开文件"}
          </Button>
        </div>
      ))}
    </section>
  )
}
const plugin: PluginWebModule = {
  id,
  apiVersion: 1,
  ownsConfiguration: true,
  pages: [{ id: "editor", component: Page }],
  tabs: [
    {
      id: "files",
      component: FileDirectory,
      icon: Folder,
      description: "浏览工作区目录与文件",
    },
    {
      id: "preview",
      component: FilePanel,
      icon: File,
      resourceKey: (payload) =>
        (payload as { path?: string } | undefined)?.path || "",
      title: (path) => nameOf(path),
    },
    {
      id: "changes",
      component: FileChanges,
      icon: FileDiff,
      description: "查看会话操作与 Git 差异",
    },
  ],
  deliveries: [
    { id: "file-link", version: 1, component: FileDelivery },
    { id: "file-change", version: 1, component: FileDelivery },
  ],
  connectSession,
}
export default plugin
