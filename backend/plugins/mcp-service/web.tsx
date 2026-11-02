import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import { callPlugin, pluginsChanged } from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import type { McpServiceClient, McpServiceStatus } from "./types"
import "./web.css"
const invoke = async <T,>(name: string, input: object, signal?: AbortSignal) =>
  (
    await callPlugin<{ value: T }>(
      "mcp-service",
      name,
      input,
      undefined,
      signal
    )
  ).value
const service: McpServiceClient = {
  read: (signal) => invoke("status", {}, signal),
  save: (input, signal) => invoke("save", input, signal),
  reveal: (signal) => invoke("reveal", {}, signal),
  reset: (revision, signal) => invoke("reset", { revision }, signal),
}
export const clientConfiguration = (url: string) => ({
  codex: `[mcp_servers.moon]\nurl = "${url}"\nbearer_token_env_var = "MOON_MCP_TOKEN"`,
  dsh: `- id: mcp-moon\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: moon\n    transport: streamable-http\n    url: ${url}\n    headers:\n      Authorization: !!js '\`Bearer \${process.env.MOON_MCP_TOKEN}\`'`,
})
const message = (error: unknown) =>
  error instanceof Error ? error.message : "MCP 操作未确认，请重新读取。"
export function Page({
  service: source = service,
}: {
  service?: McpServiceClient
}) {
  const [value, setValue] = useState<McpServiceStatus>()
  const [port, setPort] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [token, setToken] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const apply = (next: McpServiceStatus) => {
    setValue(next)
    setPort(String(next.port))
    setSelected(next.selected)
    setToken("")
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void source
      .read(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) apply(next)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error))
      })
    return () => {
      controller.abort()
      lifetime.current = null
    }
  }, [source])
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || busy.current) return
    busy.current = true
    setPending(true)
    setError("")
    setNotice("")
    try {
      await action(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) setError(message(error))
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
  const dirty =
    value &&
    (Number(port) !== value.port ||
      JSON.stringify([...selected].sort()) !==
        JSON.stringify([...value.selected].sort()))
  const configurations = value && clientConfiguration(value.url)
  return (
    <section className="mcp-service-page" aria-label="Moon MCP 服务">
      <header className="mcp-service-header">
        <div>
          <h2>本机 MCP 服务</h2>
          <p>为 Codex、DSH 等客户端共享已授权的插件工具。</p>
        </div>
        <div className="mcp-service-header-side">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              void run(async (signal) => {
                const next = await source.read(signal)
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
        <>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="moon-mcp-address">服务地址</FieldLabel>
              <div className="mcp-service-actions">
                <Input id="moon-mcp-address" readOnly value={value.url} />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void run((signal) => copy(value.url, signal))}
                >
                  复制
                </Button>
              </div>
              <FieldDescription>
                仅本机 127.0.0.1 可访问。启停服务请返回插件详情。
              </FieldDescription>
            </Field>
            <Field data-invalid={invalidPort}>
              <FieldLabel htmlFor="moon-mcp-port">固定端口</FieldLabel>
              <Input
                id="moon-mcp-port"
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
              <FieldLabel htmlFor="moon-mcp-token">访问 token</FieldLabel>
              <Input
                id="moon-mcp-token"
                readOnly
                type={token ? "text" : "password"}
                value={token || "••••••••••••••••"}
              />
              <div className="mcp-service-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    token
                      ? setToken("")
                      : void run(async (signal) => {
                          const result = await source.reveal(signal)
                          if (!signal.aborted) setToken(result.token)
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
                      const result = await source.reveal(signal)
                      if (!signal.aborted) await copy(result.token, signal)
                    })
                  }
                >
                  复制
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={pending}
                  onClick={() =>
                    void run(async (signal) => {
                      const next = await source.reset(value.revision, signal)
                      if (!signal.aborted) {
                        apply(next)
                        pluginsChanged()
                        setNotice(
                          "token 已重置；旧连接与旧 token 已失效，请更新客户端。"
                        )
                      }
                    })
                  }
                >
                  重置
                </Button>
              </div>
              <FieldDescription>
                客户端可调用下方已共享的工具；重置会取消执行中的调用。
              </FieldDescription>
            </Field>
          </FieldGroup>
          <FieldSet>
            <FieldLegend>共享工具</FieldLegend>
            <FieldDescription>
              仅列出已声明共享且启用的工具；勾选并保存后对外可用，工具可能读写网站或文件。
            </FieldDescription>
            {value.tools.length ? (
              value.tools.map((tool) => (
                <Field key={tool.name} orientation="horizontal">
                  <Checkbox
                    id={`shared-${tool.name}`}
                    checked={selected.includes(tool.name)}
                    disabled={pending}
                    onCheckedChange={(checked) =>
                      setSelected((items) =>
                        checked
                          ? [...items, tool.name]
                          : items.filter((name) => name !== tool.name)
                      )
                    }
                  />
                  <div className="mcp-service-tool">
                    <FieldLabel htmlFor={`shared-${tool.name}`}>
                      {tool.name}
                      <Badge variant="outline">
                        {tool.annotations.readOnlyHint ? "只读声明" : "可写"}
                      </Badge>
                    </FieldLabel>
                    <FieldDescription>{tool.description}</FieldDescription>
                  </div>
                </Field>
              ))
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>没有可共享工具</EmptyTitle>
                  <EmptyDescription>
                    先在插件设置启用 OpenCLI
                    或其他声明共享工具的插件，再重新读取。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {selected
              .filter((name) => !value.tools.some((tool) => tool.name === name))
              .map((name) => (
                <Field key={name} orientation="horizontal">
                  <Checkbox
                    id={`shared-${name}`}
                    checked
                    disabled={pending}
                    onCheckedChange={() =>
                      setSelected((items) =>
                        items.filter((item) => item !== name)
                      )
                    }
                  />
                  <FieldLabel htmlFor={`shared-${name}`}>
                    {name}（当前停用；不可调用，可取消共享）
                  </FieldLabel>
                </Field>
              ))}
          </FieldSet>
          <div className="mcp-service-actions">
            <Button
              disabled={pending || invalidPort || !dirty}
              onClick={() =>
                void run(async (signal) => {
                  const next = await source.save(
                    { revision: value.revision, port: Number(port), selected },
                    signal
                  )
                  if (!signal.aborted) {
                    apply(next)
                    pluginsChanged()
                    setNotice("端口与共享工具已保存。")
                  }
                })
              }
            >
              {pending ? "处理中…" : "保存端口与共享工具"}
            </Button>
            {dirty && <p>有未保存的更改</p>}
          </div>
          <section className="mcp-service-config">
            <h3>客户端配置</h3>
            <p>
              在客户端进程环境设置 MOON_MCP_TOKEN 为上面的
              token，再合并配置。工具清单变化会通知支持的客户端；仍显示旧目录时重新连接。
            </p>
            {configurations && (
              <>
                <div>
                  <div className="mcp-service-header">
                    <h4>Codex</h4>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        void run((signal) => copy(configurations.codex, signal))
                      }
                    >
                      复制
                    </Button>
                  </div>
                  <pre>{configurations.codex}</pre>
                </div>
                <div>
                  <div className="mcp-service-header">
                    <h4>DSH · cordis.yml</h4>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        void run((signal) => copy(configurations.dsh, signal))
                      }
                    >
                      复制
                    </Button>
                  </div>
                  <pre>{configurations.dsh}</pre>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </section>
  )
}
export default {
  id: "mcp-service",
  apiVersion: 1,
  pages: [{ id: "service", component: () => <Page /> }],
} satisfies PluginWebModule
