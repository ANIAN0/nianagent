import { useEffect, useRef, useState } from "react"
import { Copy, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { callPlugin, pluginsChanged } from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import type {
  McpServiceClient,
  McpServiceStatus,
  RegisteredCredential,
  RegistrationResult,
} from "./types"
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
  register: (input, signal) => invoke("register", input, signal),
  rotate: (input, signal) => invoke("rotate", input, signal),
  revoke: (input, signal) => invoke("revoke", input, signal),
  credentials: (signal) => invoke("credentials", {}, signal),
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
  const [credentialsList, setCredentialsList] = useState<
    RegisteredCredential[]
  >([])
  const [newAgentName, setNewAgentName] = useState("")
  const [issued, setIssued] = useState<RegistrationResult | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const loadCredentials = async (signal: AbortSignal) => {
    const result = await source.credentials(signal)
    if (!signal.aborted) setCredentialsList(result.credentials)
  }
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
    // 与 loadCredentials 同源；effect 内直接消费 promise，setState 仅出现在回调中
    void source
      .credentials(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCredentialsList(result.credentials)
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
    <div className="flex min-w-0 flex-col gap-5" aria-label="Moon MCP 服务">
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
        <div className="flex flex-col gap-4" aria-label="正在读取 MCP 服务">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <section
            className="flex flex-col gap-4 rounded-xl border bg-card p-5"
            aria-label="本机 MCP 服务"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="text-sm font-semibold">服务监听与地址</h3>
                <Badge variant={value.running ? "secondary" : "outline"}>
                  {value.running ? "运行中" : "未监听"}
                </Badge>
                {notice && (
                  <span role="status" className="text-xs text-muted-foreground">
                    {notice}
                  </span>
                )}
              </div>
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
                <RefreshCw className="size-3.5" />
                刷新状态
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
              <Field>
                <FieldLabel htmlFor="moon-mcp-address">服务地址</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="moon-mcp-address"
                    readOnly
                    className="min-w-0 flex-1 font-mono text-xs"
                    value={value.url}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      void run((signal) => copy(value.url, signal))
                    }
                  >
                    <Copy className="size-3.5" />
                    复制
                  </Button>
                </div>
                <FieldDescription>仅本机 127.0.0.1 可访问。</FieldDescription>
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
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button
                size="sm"
                disabled={pending || invalidPort || !dirty}
                onClick={() =>
                  void run(async (signal) => {
                    const next = await source.save(
                      {
                        revision: value.revision,
                        port: Number(port),
                        selected,
                      },
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
              {dirty && (
                <span className="text-xs text-muted-foreground">
                  有未保存的更改（端口或共享工具已修改）
                </span>
              )}
            </div>
          </section>

          <section
            className="flex flex-col gap-4 rounded-xl border bg-card p-5"
            aria-label="共享工具"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">
                  共享工具（{selected.length}/{value.tools.length}）
                </h3>
                <p className="text-xs text-muted-foreground">
                  勾选后点击上方「保存端口与共享工具」生效，工具可能读写网站或文件。
                </p>
              </div>
            </div>
            {value.tools.length ? (
              <div className="flex flex-col gap-2">
                {value.tools.map((tool) => (
                  <label
                    key={tool.name}
                    htmlFor={`shared-${tool.name}`}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40"
                  >
                    <Checkbox
                      id={`shared-${tool.name}`}
                      className="mt-0.5"
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
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-medium">
                          {tool.name}
                        </span>
                        <Badge variant="outline">
                          {tool.annotations.readOnlyHint ? "只读" : "可写"}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {tool.description}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>没有可共享工具</EmptyTitle>
                  <EmptyDescription>
                    先启用 OpenCLI 或其他声明共享工具的插件，再刷新状态。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {selected
              .filter((name) => !value.tools.some((tool) => tool.name === name))
              .map((name) => (
                <label
                  key={name}
                  htmlFor={`shared-${name}`}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground"
                >
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
                  <span>{name}（所属插件当前停用，可取消勾选）</span>
                </label>
              ))}
          </section>

          <section
            className="flex flex-col gap-4 rounded-xl border bg-card p-5"
            aria-label="访问凭据与 Agent 登记"
          >
            <div>
              <h3 className="text-sm font-semibold">Agent 专属凭据</h3>
              <p className="text-xs text-muted-foreground">
                每个外部 Agent 单独登记凭据，token
                仅在登记或轮换时显示一次；撤销立即关闭其连接。
              </p>
            </div>
            {issued && (
              <Alert>
                <AlertTitle>已签发，仅本次显示</AlertTitle>
                <AlertDescription>
                  <div className="mt-1 flex flex-col gap-2">
                    <span className="text-xs">
                      actor {issued.actorId} · 凭据 {issued.credentialId}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 flex-1 rounded bg-muted px-2 py-1 text-xs break-all">
                        {issued.token}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          void run((signal) => copy(issued.token, signal))
                        }
                      >
                        复制 token
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => setIssued(null)}
                      >
                        关闭
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {credentialsList.length ? (
              <div className="flex flex-col gap-2">
                {credentialsList.map((item) => (
                  <div
                    key={item.credentialId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {item.displayName}
                        </span>
                        <Badge variant={item.valid ? "secondary" : "outline"}>
                          {item.kind === "legacy"
                            ? "旧共享凭据"
                            : item.valid
                              ? "有效"
                              : "已撤销"}
                        </Badge>
                      </div>
                      <span className="font-mono text-xs break-all text-muted-foreground">
                        actor {item.actorId} · {item.credentialId}
                        {item.revokedAt ? ` · 撤销于 ${item.revokedAt}` : ""}
                      </span>
                    </div>
                    {item.kind === "agent" && item.valid && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            void run(async (signal) => {
                              const result = await source.rotate(
                                { actorId: item.actorId },
                                signal
                              )
                              if (!signal.aborted) {
                                setIssued(result)
                                await loadCredentials(signal)
                              }
                            })
                          }
                        >
                          轮换
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={pending}
                          onClick={() =>
                            void run(async (signal) => {
                              const next = await source.revoke(
                                { credentialId: item.credentialId },
                                signal
                              )
                              if (!signal.aborted) {
                                apply(next)
                                await loadCredentials(signal)
                                setNotice("凭据已撤销；其协议连接已关闭。")
                              }
                            })
                          }
                        >
                          撤销
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>还没有登记 Agent 凭据</EmptyTitle>
                  <EmptyDescription>
                    为外部 Agent 登记独立凭据后可随时轮换或撤销。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            <Field>
              <FieldLabel htmlFor="moon-mcp-agent-name">
                登记新 Agent
              </FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="moon-mcp-agent-name"
                  className="min-w-[200px] flex-1"
                  value={newAgentName}
                  placeholder="如：审阅 Agent A"
                  onChange={(event) => setNewAgentName(event.target.value)}
                />
                <Button
                  size="sm"
                  disabled={pending || !newAgentName.trim()}
                  onClick={() =>
                    void run(async (signal) => {
                      const result = await source.register(
                        { displayName: newAgentName.trim() },
                        signal
                      )
                      if (!signal.aborted) {
                        setIssued(result)
                        setNewAgentName("")
                        await loadCredentials(signal)
                      }
                    })
                  }
                >
                  登记
                </Button>
              </div>
            </Field>
            <div className="border-t pt-4">
              <Field>
                <FieldLabel htmlFor="moon-mcp-token">
                  旧共享访问 token（兼容）
                </FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="moon-mcp-token"
                    readOnly
                    className="min-w-[200px] flex-1 font-mono text-xs"
                    type={token ? "text" : "password"}
                    value={token || "••••••••••••••••"}
                  />
                  <Button
                    variant="outline"
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
                    variant="outline"
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
                  仅用于兼容旧客户端，不能访问笔记工作台工具；重置会取消执行中的调用。
                </FieldDescription>
              </Field>
            </div>
          </section>

          {configurations && (
            <section
              className="flex flex-col gap-4 rounded-xl border bg-card p-5"
              aria-label="客户端配置"
            >
              <div>
                <h3 className="text-sm font-semibold">客户端配置示例</h3>
                <p className="text-xs text-muted-foreground">
                  在客户端环境中设置 <code>MOON_MCP_TOKEN</code>{" "}
                  为上方凭据后合并配置。
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">Codex</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      void run((signal) => copy(configurations.codex, signal))
                    }
                  >
                    <Copy className="size-3.5" />
                    复制
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                  {configurations.codex}
                </pre>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">DSH · cordis.yml</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      void run((signal) => copy(configurations.dsh, signal))
                    }
                  >
                    <Copy className="size-3.5" />
                    复制
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                  {configurations.dsh}
                </pre>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
export default {
  id: "mcp-service",
  apiVersion: 1,
  pages: [{ id: "service", component: () => <Page /> }],
} satisfies PluginWebModule
