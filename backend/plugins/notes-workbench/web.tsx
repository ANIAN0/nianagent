import { useEffect, useRef, useState } from "react"
import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core"
import { Copy, ExternalLink, RefreshCw, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { callPlugin, pluginsChanged } from "@/features/plugins/plugin-service"
import type {
  PluginDeliveryProps,
  PluginWebModule,
} from "@/features/plugins/plugin-api"
import { isRemoteWeb } from "@/lib/rpc/remote-transport"
import "./web.css"

type WorkbenchStatus = {
  running: boolean
  url: string
  port: number
  revision: number
  issue: string
  logIssue: string
}
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
  error instanceof Error ? error.message : "操作未确认，请重新读取。"

export function Page() {
  const [value, setValue] = useState<WorkbenchStatus>()
  const [port, setPort] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const apply = (next: WorkbenchStatus) => {
    setValue(next)
    setPort(String(next.port))
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void invoke<WorkbenchStatus>("status", {}, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) apply(next)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(message(reason))
      })
    return () => {
      controller.abort()
      lifetime.current = null
    }
  }, [])
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || busy.current) return
    busy.current = true
    setPending(true)
    setError("")
    setNotice("")
    try {
      await action(controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted) setError(message(reason))
    } finally {
      busy.current = false
      if (!controller.signal.aborted) setPending(false)
    }
  }
  const copy = async (text: string, signal: AbortSignal) => {
    await navigator.clipboard.writeText(text)
    if (!signal.aborted) setNotice("已复制。")
  }
  const invalidPort =
    !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535
  const dirty = value && Number(port) !== value.port
  return (
    <div className="flex min-w-0 flex-col gap-5" aria-label="Moon 笔记工作台">
      {error && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {(value?.issue || value?.logIssue) && (
        <Alert>
          <AlertTitle>服务需要处理</AlertTitle>
          <AlertDescription>{value.issue || value.logIssue}</AlertDescription>
        </Alert>
      )}
      {!value ? (
        <div className="flex flex-col gap-4" aria-label="正在读取工作台状态">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <section
            className="flex flex-col gap-4 rounded-xl border bg-card p-5"
            aria-label="工作台服务与入口"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="text-sm font-semibold">本机工作台服务</h3>
                <Badge variant={value.running ? "secondary" : "outline"}>
                  {value.running ? "运行中" : "未监听"}
                </Badge>
                {notice && (
                  <span role="status" className="text-xs text-muted-foreground">
                    {notice}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void run(async (signal) => {
                      const next = await invoke<WorkbenchStatus>(
                        "status",
                        {},
                        signal
                      )
                      if (!signal.aborted) apply(next)
                    })
                  }
                >
                  <RefreshCw className="size-3.5" />
                  刷新状态
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void run(async (signal) => {
                      await invoke("reload", {}, signal)
                      if (!signal.aborted)
                        setNotice("页面资源已重载，请刷新已打开的工作台。")
                    })
                  }
                >
                  <RotateCw className="size-3.5" />
                  重载页面
                </Button>
                <Button
                  size="sm"
                  disabled={pending || !value.running}
                  onClick={() =>
                    void run(async (signal) => {
                      if (signal.aborted) return
                      // 先换一次性票据再打开；长期 token 由页面资源注入内存，不进入 URL。
                      const opened = await invoke<{
                        ticket: string
                        url: string
                      }>("ticket", {}, signal)
                      // 桌面 WebView 不处理 window.open，走系统浏览器（与模型授权同模式）。
                      if (isTauri())
                        await tauriInvoke("open_local_url", { url: opened.url })
                      else
                        window.open(opened.url, "_blank", "noopener,noreferrer")
                    })
                  }
                >
                  <ExternalLink className="size-3.5" />
                  打开工作台
                </Button>
              </div>
            </div>
            <Field>
              <FieldLabel htmlFor="moon-notes-address">工作台地址</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="moon-notes-address"
                  readOnly
                  className="min-w-0 flex-1 font-mono text-xs"
                  value={value.url}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => void run((signal) => copy(value.url, signal))}
                >
                  <Copy className="size-3.5" />
                  复制
                </Button>
              </div>
              <FieldDescription>
                仅本机回环可访问；Agent 通过 MCP 发布产物与读取评论。
              </FieldDescription>
            </Field>
          </section>

          <section
            className="flex flex-col gap-4 rounded-xl border bg-card p-5"
            aria-label="端口设置"
          >
            <h3 className="text-sm font-semibold">端口设置</h3>
            <Field data-invalid={invalidPort}>
              <FieldLabel htmlFor="moon-notes-port">固定端口</FieldLabel>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  id="moon-notes-port"
                  type="number"
                  min={1024}
                  max={65535}
                  className="w-36"
                  value={port}
                  aria-invalid={invalidPort}
                  onChange={(event) => setPort(event.target.value)}
                />
                <Button
                  size="sm"
                  disabled={pending || invalidPort || !dirty}
                  onClick={() =>
                    void run(async (signal) => {
                      const next = await invoke<WorkbenchStatus>(
                        "save",
                        { revision: value.revision, port: Number(port) },
                        signal
                      )
                      if (!signal.aborted) {
                        apply(next)
                        pluginsChanged()
                        setNotice("端口已保存。")
                      }
                    })
                  }
                >
                  {pending ? "处理中…" : "保存端口"}
                </Button>
                {dirty && (
                  <span className="text-xs text-muted-foreground">
                    有未保存的更改
                  </span>
                )}
              </div>
              <FieldDescription>
                范围 1024–65535，修改后将自动切换监听。
              </FieldDescription>
            </Field>
          </section>
        </>
      )}
    </div>
  )
}
type NotesPagePayload = {
  draftId: string
  versionId?: string
  title?: string
  summary?: string
}

/** 聊天内交付卡：列出本轮发布或更新的笔记版本，换票后在浏览器工作台打开对应 v2 视图。 */
export function NotesPageDelivery({
  delivery,
  deliveries = [delivery],
}: PluginDeliveryProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const pages = new Map<string, NotesPagePayload>()
  for (const record of deliveries) {
    const value = JSON.parse(record.payload) as NotesPagePayload
    if (typeof value.draftId !== "string" || !value.draftId)
      throw new Error("交付草稿标识无效。")
    pages.set(
      value.versionId ? `${value.draftId}#${value.versionId}` : value.draftId,
      value
    )
  }
  const openInWorkbench = async (item: NotesPagePayload) => {
    setPending(true)
    setError("")
    try {
      const status = await invoke<WorkbenchStatus>("status", {})
      if (!status.running || !status.url)
        throw new Error("笔记工作台未运行；请在插件详情页启用后重试。")
      // 先换一次性票据；深链与票据分离——hash 进地址，token 只进内存。
      const opened = await invoke<{ ticket: string; url: string }>("ticket", {})
      const params = new URLSearchParams({ draft: item.draftId })
      if (item.versionId) params.set("version", item.versionId)
      const url = `${opened.url}#v2?${params}`
      // 桌面 WebView 不处理 window.open，走系统浏览器（与插件详情页同模式）。
      if (isTauri()) await tauriInvoke("open_local_url", { url })
      else window.open(url, "_blank", "noopener,noreferrer")
    } catch (reason) {
      setError(message(reason))
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="notes-delivery-card">
      <strong>笔记版本</strong>
      {[...pages.values()].map((page) => (
        <div
          key={
            page.versionId ? `${page.draftId}#${page.versionId}` : page.draftId
          }
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span>
            {page.title || "笔记版本"}
            {page.summary ? ` · ${page.summary}` : ""}
          </span>
          {/* 工作台操作均限本机（remote: false），远程 Web 只展示清单不提供跳转。 */}
          {!isRemoteWeb() && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void openInWorkbench(page)}
            >
              在工作台打开
            </Button>
          )}
        </div>
      ))}
      {error && <p className="m-0 text-[12px] text-destructive">{error}</p>}
    </section>
  )
}

export default {
  id: "notes-workbench",
  apiVersion: 1,
  pages: [{ id: "workbench", component: () => <Page /> }],
  deliveries: [{ id: "notes-page", version: 1, component: NotesPageDelivery }],
} satisfies PluginWebModule
