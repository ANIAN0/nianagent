import { useEffect, useRef, useState } from "react"
import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core"
import { Check, Copy, ExternalLink, RefreshCw, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { notifyToast } from "@/components/ui/notification-toast"
import { callPlugin, pluginsChanged } from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import { isRemoteWeb } from "@/lib/rpc/remote-transport"

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
      "skill-workbench",
      name,
      input,
      undefined,
      signal
    )
  ).value

const message = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === "string" && error.trim()) return error
  return "操作未确认，请重新读取。"
}

export function Page() {
  const [value, setValue] = useState<WorkbenchStatus>()
  const [port, setPort] = useState("")
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
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
    if (!signal.aborted) {
      setCopied(true)
      notifyToast("已复制到剪贴板", { tone: "success" })
      window.setTimeout(() => {
        setCopied(false)
      }, 1600)
    }
  }

  const invalidPort =
    !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535
  const dirty = value && Number(port) !== value.port

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-label="Moon Skill 工作台">
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
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : (
        <section
          className="flex flex-col gap-4 rounded-xl border bg-card p-4"
          aria-label="Skill 工作台服务与入口"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                className={
                  value.running
                    ? "size-2 rounded-full bg-emerald-500"
                    : "size-2 rounded-full bg-muted-foreground/40"
                }
              />
              <span className="text-sm font-medium">
                {value.running ? "本机监听中" : "未监听"}
              </span>
              <span className="text-xs text-muted-foreground">
                仅本机 127.0.0.1
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              重启或更改端口会短暂中断笔记和 Skill。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="text-xs"
                disabled={pending}
                onClick={() =>
                  void run(async (signal) => {
                    await invoke("reload", {}, signal)
                    const next = await invoke<WorkbenchStatus>(
                      "status",
                      {},
                      signal
                    )
                    if (!signal.aborted) {
                      apply(next)
                      notifyToast("共享工作台已连接", { tone: "success" })
                    }
                  })
                }
              >
                <RotateCw className="size-3.5" />
                重启共享服务
              </Button>
              <Button
                variant="outline"
                className="text-xs"
                disabled={pending}
                onClick={() =>
                  void run(async (signal) => {
                    const next = await invoke<WorkbenchStatus>(
                      "status",
                      {},
                      signal
                    )
                    if (!signal.aborted) {
                      apply(next)
                      notifyToast("状态已刷新", { tone: "success" })
                    }
                  })
                }
              >
                <RefreshCw className="size-3.5" />
                刷新
              </Button>
              <Button
                className="text-xs"
                disabled={pending || !value.running || isRemoteWeb()}
                onClick={() =>
                  void run(async (signal) => {
                    if (signal.aborted) return
                    if (isTauri())
                      await tauriInvoke("open_local_url", { url: value.url })
                    else window.open(value.url, "_blank", "noopener,noreferrer")
                  })
                }
              >
                <ExternalLink className="size-3.5" />
                打开工作台
              </Button>
            </div>
          </div>

          <div className="grid gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-[64px_minmax(0,1fr)] sm:items-center">
            <label
              htmlFor="skill-workbench-port"
              className="text-xs font-medium whitespace-nowrap text-muted-foreground"
            >
              共享监听端口
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="skill-workbench-port"
                type="number"
                min={1024}
                max={65535}
                className="h-8 w-28 font-mono text-xs"
                value={port}
                aria-label="固定端口"
                aria-invalid={invalidPort}
                onChange={(event) => setPort(event.target.value)}
                disabled={pending || isRemoteWeb()}
              />
              <Button
                variant="outline"
                className="text-xs"
                disabled={pending || invalidPort || !dirty || isRemoteWeb()}
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
                      notifyToast("端口已保存", { tone: "success" })
                    }
                  })
                }
              >
                {pending ? "保存中…" : "保存端口"}
              </Button>
              {invalidPort && (
                <span className="text-xs text-destructive">
                  请输入 1024–65535 之间的端口
                </span>
              )}
            </div>

            <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
              工作台地址
            </span>
            <div className="flex min-w-0 items-center gap-2">
              <div
                aria-label="工作台地址"
                className="flex h-8 min-w-0 flex-1 items-center rounded-lg bg-muted/60 px-3 font-mono text-xs text-foreground"
              >
                <span className="truncate select-all">{value.url}</span>
              </div>
              <Button
                variant="outline"
                className="text-xs"
                disabled={pending}
                onClick={() => void run((signal) => copy(value.url, signal))}
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

const module: PluginWebModule = {
  id: "skill-workbench",
  apiVersion: 1,
  pages: [{ id: "workbench", component: Page }],
}

export default module
