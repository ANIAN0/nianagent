import { useEffect, useRef, useState } from "react"
import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { callPlugin, pluginsChanged } from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import "./web.css"

type WorkbenchStatus = {
  running: boolean
  url: string
  port: number
  revision: number
  issue: string
  logIssue: string
  directories: number
  pages: number
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
  const [token, setToken] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const apply = (next: WorkbenchStatus) => {
    setValue(next)
    setPort(String(next.port))
    setToken("")
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
    <section className="notes-workbench-page" aria-label="Moon 笔记工作台">
      <header className="notes-workbench-header">
        <div>
          <h2>笔记工作台</h2>
          <p>与 agent 在真实前端页面上圈选元素沟通样式。</p>
        </div>
        <div className="notes-workbench-header-side">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              void run(async (signal) => {
                const next = await invoke<WorkbenchStatus>("status", {}, signal)
                if (!signal.aborted) apply(next)
              })
            }
          >
            重新读取
          </Button>
          <Badge variant={value?.running ? "secondary" : "outline"}>
            {value ? (value.running ? "运行中" : "未监听") : "读取中"}
          </Badge>
        </div>
      </header>
      {error && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      {(value?.issue || value?.logIssue) && (
        <Alert>
          <AlertTitle>服务需要处理</AlertTitle>
          <AlertDescription>{value.issue || value.logIssue}</AlertDescription>
        </Alert>
      )}
      {value && (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="moon-notes-address">工作台地址</FieldLabel>
            <div className="notes-workbench-actions">
              <Input id="moon-notes-address" readOnly value={value.url} />
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => void run((signal) => copy(value.url, signal))}
              >
                复制
              </Button>
              <Button
                size="sm"
                disabled={pending || !value.running}
                onClick={() =>
                  void run(async (signal) => {
                    const opened = await invoke<{ ticket: string }>(
                      "ticket",
                      {},
                      signal
                    )
                    if (signal.aborted) return
                    const url = `${value.url}?ticket=${opened.ticket}`
                    // 桌面 WebView 不处理 window.open，走系统浏览器（与模型授权同模式）。
                    if (isTauri()) await tauriInvoke("open_local_url", { url })
                    else window.open(url, "_blank", "noopener,noreferrer")
                  })
                }
              >
                打开工作台
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  void run(async (signal) => {
                    await invoke("reload", {}, signal)
                    if (!signal.aborted)
                      setNotice("页面资源已重载，已打开的工作台将自动刷新。")
                  })
                }
              >
                重载页面
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  void run(async (signal) => {
                    const result = await invoke<{
                      createdDirectories: number
                      createdPages: number
                      skipped: number
                    }>("load_seed", {}, signal)
                    if (!signal.aborted)
                      setNotice(
                        `已导入示例：新建 ${result.createdDirectories} 个目录、${result.createdPages} 个页面，跳过 ${result.skipped} 个同名页面。`,
                      )
                  })
                }
              >
                导入目录示例
              </Button>
            </div>
            <FieldDescription>
              仅本机 127.0.0.1 可访问；agent
              通过笔记工具创建目录与页面。更新构建产物后点「重载页面」，已打开的工作台自动刷新。
            </FieldDescription>
          </Field>
          <Field data-invalid={invalidPort}>
            <FieldLabel htmlFor="moon-notes-port">固定端口</FieldLabel>
            <Input
              id="moon-notes-port"
              type="number"
              min={1024}
              max={65535}
              value={port}
              aria-invalid={invalidPort}
              onChange={(event) => setPort(event.target.value)}
            />
            <FieldDescription>1024–65535。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="moon-notes-token">访问 token</FieldLabel>
            <Input
              id="moon-notes-token"
              readOnly
              type={token ? "text" : "password"}
              value={token || "••••••••••••••••"}
            />
            <div className="notes-workbench-actions">
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  token
                    ? setToken("")
                    : void run(async (signal) => {
                        const revealed = await invoke<{ token: string }>(
                          "reveal",
                          {},
                          signal
                        )
                        if (!signal.aborted) setToken(revealed.token)
                      })
                }
              >
                {token ? "隐藏" : "显示"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  void run(async (signal) => {
                    const revealed = await invoke<{ token: string }>(
                      "reveal",
                      {},
                      signal
                    )
                    if (!signal.aborted) await copy(revealed.token, signal)
                  })
                }
              >
                复制
              </Button>
            </div>
            <FieldDescription>
              打开经一次性票据完成；token 仅注入页面内存与会话存储，此处供显示或手工复制。
            </FieldDescription>
          </Field>
          <div className="notes-workbench-actions">
            <Button
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
            {dirty && <p>有未保存的更改</p>}
          </div>
        </FieldGroup>
      )}
    </section>
  )
}
export default {
  id: "notes-workbench",
  apiVersion: 1,
  pages: [{ id: "workbench", component: () => <Page /> }],
} satisfies PluginWebModule
