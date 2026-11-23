import { useEffect, useMemo, useRef, useState } from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  Copy,
  RefreshCw,
  Search,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { callPlugin, pluginsChanged } from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import type {
  McpServiceClient,
  McpServiceStatus,
  RegisteredCredential,
  RegistrationResult,
  SharedToolDescriptor,
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

const PLUGIN_LABELS: Record<string, string> = {
  opencli: "OpenCLI",
  memos: "Memos",
  filebrowser: "FileBrowser",
  "notes-workbench": "笔记工作台",
  "file-workbench": "文件工作台",
  "skill-workbench": "Skill 工作台",
  "example-note": "示例笔记",
}

const pluginLabel = (pluginId: string) => PLUGIN_LABELS[pluginId] || pluginId

const shortToolName = (tool: SharedToolDescriptor) => {
  const prefix = `${tool.plugin}__`
  return tool.name.startsWith(prefix)
    ? tool.name.slice(prefix.length)
    : tool.name
}

type SchemaParameter = {
  name: string
  type: string
  required: boolean
  description: string
}

const formatSchemaType = (schema: Record<string, unknown>): string => {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return `enum(${schema.enum.map(String).join(" | ")})`
  }
  const rawType = schema.type
  if (rawType === "array") {
    const items = schema.items
    if (items && typeof items === "object" && !Array.isArray(items)) {
      const itemType = formatSchemaType(items as Record<string, unknown>)
      return `${itemType}[]`
    }
    return "array"
  }
  if (Array.isArray(rawType)) return rawType.map(String).join(" | ")
  if (typeof rawType === "string") return rawType
  return "any"
}

const extractParameters = (
  inputSchema: Record<string, unknown> | undefined
): SchemaParameter[] => {
  if (!inputSchema || typeof inputSchema !== "object") return []
  const props = inputSchema.properties
  if (!props || typeof props !== "object" || Array.isArray(props)) return []
  const requiredSet = new Set(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter((item): item is string => typeof item === "string")
      : []
  )
  return Object.entries(props as Record<string, unknown>)
    .map(([name, raw]) => {
      const def =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {}
      const descParts: string[] = []
      if (typeof def.description === "string" && def.description.trim()) {
        descParts.push(def.description.trim())
      }
      if (typeof def.minimum === "number" || typeof def.maximum === "number") {
        const min = typeof def.minimum === "number" ? def.minimum : ""
        const max = typeof def.maximum === "number" ? def.maximum : ""
        descParts.push(`范围 ${min}..${max}`)
      }
      return {
        name,
        type: formatSchemaType(def),
        required: requiredSet.has(name),
        description: descParts.join(" · "),
      }
    })
    .sort((left, right) => Number(right.required) - Number(left.required))
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : "MCP 操作未确认，请重新读取。"

type StatusFilter = "all" | "enabled" | "disabled"

export function Page({
  service: source = service,
}: {
  service?: McpServiceClient
}) {
  const [value, setValue] = useState<McpServiceStatus>()
  const [port, setPort] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [token, setToken] = useState("")
  const [credentialsList, setCredentialsList] = useState<
    RegisteredCredential[]
  >([])
  const [newAgentName, setNewAgentName] = useState("")
  const [issued, setIssued] = useState<RegistrationResult | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [copiedKey, setCopiedKey] = useState("")
  const [pending, setPending] = useState(false)
  const [query, setQuery] = useState("")
  const [pluginFilter, setPluginFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [inspectTool, setInspectTool] = useState<SharedToolDescriptor | null>(
    null
  )
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
      .catch((err) => {
        if (!controller.signal.aborted) setError(message(err))
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
    } catch (err) {
      if (!controller.signal.aborted) setError(message(err))
    } finally {
      busy.current = false
      if (!controller.signal.aborted) setPending(false)
    }
  }

  const copy = async (text: string, key: string, signal: AbortSignal) => {
    await navigator.clipboard.writeText(text)
    if (!signal.aborted) {
      setCopiedKey(key)
      setNotice("已复制到剪贴板")
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? "" : current))
      }, 1600)
    }
  }

  const saveSelection = (nextSelected: string[], feedback: string) => {
    if (!value || busy.current) return
    const previousSelected = value.selected
    setSelected(nextSelected)
    void run(async (signal) => {
      try {
        const next = await source.save(
          {
            revision: value.revision,
            port: value.port,
            selected: nextSelected,
          },
          signal
        )
        if (!signal.aborted) {
          apply(next)
          pluginsChanged()
          setNotice(feedback)
        }
      } catch (err) {
        if (!signal.aborted) setSelected(previousSelected)
        throw err
      }
    })
  }

  const toggleTool = (toolName: string, enabled: boolean) => {
    const nextSelected = enabled
      ? [...new Set([...selected, toolName])]
      : selected.filter((name) => name !== toolName)
    saveSelection(nextSelected, enabled ? "已启用工具共享" : "已停用工具共享")
  }

  const invalidPort =
    !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535
  const portDirty = Boolean(value && Number(port) !== value.port)
  const configurations = value && clientConfiguration(value.url)
  const hasLegacy = credentialsList.some(({ kind }) => kind === "legacy")
  const hasActiveLegacy = credentialsList.some(
    ({ kind, valid }) => kind === "legacy" && valid
  )
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const pluginOptions = useMemo(() => {
    if (!value) return []
    const counts = new Map<string, number>()
    for (const tool of value.tools) {
      counts.set(tool.plugin, (counts.get(tool.plugin) || 0) + 1)
    }
    return [...counts.entries()].map(([id, count]) => ({
      id,
      label: pluginLabel(id),
      count,
    }))
  }, [value])

  const toolParamsMap = useMemo(() => {
    const map = new Map<string, SchemaParameter[]>()
    if (!value) return map
    for (const tool of value.tools) {
      map.set(tool.name, extractParameters(tool.inputSchema))
    }
    return map
  }, [value])

  const filteredTools = useMemo(() => {
    if (!value) return []
    const keyword = query.trim().toLowerCase()
    return value.tools.filter((tool) => {
      if (pluginFilter !== "all" && tool.plugin !== pluginFilter) return false
      const enabled = selectedSet.has(tool.name)
      if (statusFilter === "enabled" && !enabled) return false
      if (statusFilter === "disabled" && enabled) return false
      if (!keyword) return true
      const params = toolParamsMap.get(tool.name) || []
      return (
        tool.name.toLowerCase().includes(keyword) ||
        shortToolName(tool).toLowerCase().includes(keyword) ||
        tool.description.toLowerCase().includes(keyword) ||
        pluginLabel(tool.plugin).toLowerCase().includes(keyword) ||
        params.some((param) => param.name.toLowerCase().includes(keyword))
      )
    })
  }, [value, query, pluginFilter, statusFilter, selectedSet, toolParamsMap])

  const totalPages = Math.max(1, Math.ceil(filteredTools.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedTools = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredTools.slice(start, start + pageSize)
  }, [filteredTools, safePage, pageSize])

  const orphanSelected = useMemo(() => {
    if (!value) return []
    const available = new Set(value.tools.map((tool) => tool.name))
    return selected.filter((name) => !available.has(name))
  }, [value, selected])

  const hasActiveFilter =
    query.trim() !== "" || pluginFilter !== "all" || statusFilter !== "all"

  const resetFilters = () => {
    setQuery("")
    setPluginFilter("all")
    setStatusFilter("all")
    setPage(1)
  }

  const inspectedParams = inspectTool
    ? toolParamsMap.get(inspectTool.name) || []
    : []
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-label="Moon MCP 服务">
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
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <section
            className="flex flex-col gap-4 rounded-xl border bg-card p-4"
            aria-label="本机接入"
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
                  仅本机 127.0.0.1 · Bearer 凭据
                </span>
                {notice && (
                  <span
                    role="status"
                    className="text-xs text-muted-foreground"
                  >
                    · {notice}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {configurations && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="text-xs">
                        <Code2 className="size-3.5" />
                        客户端配置
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>客户端接入配置</DialogTitle>
                        <DialogDescription>
                          在客户端环境中将 MOON_MCP_TOKEN 设为已登记的凭据。
                        </DialogDescription>
                      </DialogHeader>
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">Codex</span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                void run((signal) =>
                                  copy(configurations.codex, "codex", signal)
                                )
                              }
                            >
                              {copiedKey === "codex" ? (
                                <Check className="size-3.5" />
                              ) : (
                                <Copy className="size-3.5" />
                              )}
                              {copiedKey === "codex" ? "已复制" : "复制"}
                            </Button>
                          </div>
                          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5">
                            {configurations.codex}
                          </pre>
                        </div>
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">
                              DSH · cordis.yml
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                void run((signal) =>
                                  copy(configurations.dsh, "dsh", signal)
                                )
                              }
                            >
                              {copiedKey === "dsh" ? (
                                <Check className="size-3.5" />
                              ) : (
                                <Copy className="size-3.5" />
                              )}
                              {copiedKey === "dsh" ? "已复制" : "复制"}
                            </Button>
                          </div>
                          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5">
                            {configurations.dsh}
                          </pre>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={pending}
                  onClick={() =>
                    void run(async (signal) => {
                      const next = await source.read(signal)
                      await loadCredentials(signal)
                      if (!signal.aborted) {
                        apply(next)
                        setNotice("状态已刷新")
                      }
                    })
                  }
                >
                  <RefreshCw className="size-3.5" />
                  刷新
                </Button>
              </div>
            </div>

            <div className="grid gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-[64px_minmax(0,1fr)] sm:items-center">
              <label
                htmlFor="moon-mcp-port"
                className="text-xs font-medium text-muted-foreground"
              >
                监听端口
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="moon-mcp-port"
                  type="number"
                  min={1024}
                  max={65535}
                  className="h-8 w-28 font-mono text-xs"
                  value={port}
                  aria-label="固定端口"
                  aria-invalid={invalidPort}
                  onChange={(event) => setPort(event.target.value)}
                />
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={pending || invalidPort || !portDirty}
                  onClick={() =>
                    void run(async (signal) => {
                      const next = await source.save(
                        {
                          revision: value.revision,
                          port: Number(port),
                          selected: value.selected,
                        },
                        signal
                      )
                      if (!signal.aborted) {
                        apply(next)
                        pluginsChanged()
                        setNotice("端口已保存")
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

              <span className="text-xs font-medium text-muted-foreground">
                接入地址
              </span>
              <div className="flex min-w-0 items-center gap-2">
                <div
                  aria-label="本机接入地址"
                  className="flex h-8 min-w-0 flex-1 items-center rounded-lg bg-muted/60 px-3 font-mono text-xs text-foreground"
                >
                  <span className="truncate select-all">{value.url}</span>
                </div>
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={pending}
                  onClick={() =>
                    void run((signal) => copy(value.url, "url", signal))
                  }
                >
                  {copiedKey === "url" ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copiedKey === "url" ? "已复制" : "复制地址"}
                </Button>
              </div>
            </div>
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
                          void run((signal) => copy(issued.token, "issued-token", signal))
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
            {hasLegacy && (
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
                      disabled={pending || !hasActiveLegacy}
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
                      disabled={pending || !hasActiveLegacy}
                      onClick={() =>
                        void run(async (signal) => {
                          const result = await source.reveal(signal)
                          if (!signal.aborted) await copy(result.token, "legacy-token", signal)
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
                          const next = await source.reset(
                            value.revision,
                            signal
                          )
                          if (!signal.aborted) {
                            apply(next)
                            await loadCredentials(signal)
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
            )}
          </section>

          <section
            className="flex flex-col gap-3 rounded-xl border bg-card p-4"
            aria-label="共享工具"
          >
            <h3 className="text-sm font-semibold">共享工具</h3>

            {value.tools.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="搜索工具"
                    className="h-8 pr-8 pl-8 text-xs"
                    placeholder="搜索工具名、描述或入参…"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setPage(1)
                    }}
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="清除搜索"
                      className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setQuery("")
                        setPage(1)
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>

                {pluginOptions.length > 1 && (
                  <Select
                    value={pluginFilter}
                    onValueChange={(next) => {
                      setPluginFilter(next)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger
                      aria-label="按插件分组筛选"
                      className="w-[152px] text-xs"
                    >
                      <SelectValue placeholder="全部分组" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">
                        全部分组（{value.tools.length}）
                      </SelectItem>
                      {pluginOptions.map((option) => (
                        <SelectItem
                          key={option.id}
                          value={option.id}
                          className="text-xs"
                        >
                          {option.label}（{option.count}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <div
                  role="group"
                  aria-label="按启用状态筛选"
                  className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5"
                >
                  {(
                    [
                      { id: "all", label: "全部" },
                      { id: "enabled", label: "已启用" },
                      { id: "disabled", label: "未启用" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={statusFilter === item.id}
                      className={
                        statusFilter === item.id
                          ? "h-full rounded-md bg-background px-2.5 text-xs font-medium text-foreground shadow-2xs"
                          : "h-full rounded-md px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      }
                      onClick={() => {
                        setStatusFilter(item.id)
                        setPage(1)
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {value.tools.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>没有可共享工具</EmptyTitle>
                  <EmptyDescription>
                    先启用 OpenCLI 或其他声明共享工具的插件，再刷新状态。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : filteredTools.length === 0 ? (
              <Empty className="border py-8">
                <EmptyHeader>
                  <EmptyTitle>没有匹配的工具</EmptyTitle>
                  <EmptyDescription>
                    调整搜索关键词或筛选条件以查看可用工具。
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" className="text-xs" onClick={resetFilters}>
                    重置筛选
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <>
                <div className="overflow-hidden rounded-lg border">
                  <Table className="table-fixed">
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-9 w-[108px] px-3 pl-4 text-left text-xs font-semibold text-muted-foreground">
                          分组
                        </TableHead>
                        <TableHead className="h-9 w-[160px] px-3 text-left text-xs font-semibold text-muted-foreground">
                          工具名称
                        </TableHead>
                        <TableHead className="h-9 w-[184px] px-3 text-left text-xs font-semibold text-muted-foreground">
                          入参
                        </TableHead>
                        <TableHead className="h-9 px-3 text-left text-xs font-semibold text-muted-foreground">
                          描述
                        </TableHead>
                        <TableHead className="h-9 w-[72px] px-3 pr-4 text-right text-xs font-semibold text-muted-foreground">
                          启用
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedTools.map((tool) => {
                        const enabled = selectedSet.has(tool.name)
                        const params = toolParamsMap.get(tool.name) || []
                        const shortName = shortToolName(tool)
                        const visibleParams = params.slice(0, 2)
                        const hiddenParamCount =
                          params.length - visibleParams.length
                        return (
                          <TableRow
                            key={tool.name}
                            className="cursor-pointer"
                            onClick={() => setInspectTool(tool)}
                          >
                            <TableCell className="px-3 py-2.5 pl-4 text-left text-xs text-muted-foreground">
                              <span
                                title={pluginLabel(tool.plugin)}
                                className="block truncate"
                              >
                                {pluginLabel(tool.plugin)}
                              </span>
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-left">
                              <span
                                title={tool.name}
                                className="block truncate font-mono text-xs font-medium text-foreground"
                              >
                                {shortName}
                              </span>
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-left">
                              {params.length === 0 ? (
                                <span className="text-xs text-muted-foreground/70">
                                  无入参
                                </span>
                              ) : (
                                <div className="flex items-center gap-1 overflow-hidden">
                                  {visibleParams.map((param) => (
                                    <code
                                      key={param.name}
                                      title={`${param.name}: ${param.type}${param.required ? "（必填）" : "（可选）"}`}
                                      className="max-w-[84px] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
                                    >
                                      {param.name}
                                      {param.required ? "*" : ""}
                                    </code>
                                  ))}
                                  {hiddenParamCount > 0 && (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      +{hiddenParamCount}
                                    </span>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-left text-xs text-muted-foreground">
                              <span
                                title={tool.description}
                                className="block truncate"
                              >
                                {tool.description}
                              </span>
                            </TableCell>
                            <TableCell
                              className="px-3 py-2.5 pr-4 text-right"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="flex items-center justify-end">
                                <Switch
                                  size="sm"
                                  aria-label={`启用 ${shortName}`}
                                  checked={enabled}
                                  disabled={pending}
                                  onCheckedChange={(next) =>
                                    toggleTool(tool.name, next)
                                  }
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div
                  className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground"
                  aria-label="表格分页"
                >
                  <span>
                    {hasActiveFilter
                      ? `筛选结果 ${filteredTools.length} 项（共 ${value.tools.length} 项）`
                      : `共 ${value.tools.length} 项`}
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span>每页</span>
                      <Select
                        value={String(pageSize)}
                        onValueChange={(next) => {
                          setPageSize(Number(next))
                          setPage(1)
                        }}
                      >
                        <SelectTrigger
                          aria-label="每页显示条数"
                          className="w-[72px] text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10" className="text-xs">
                            10
                          </SelectItem>
                          <SelectItem value="20" className="text-xs">
                            20
                          </SelectItem>
                          <SelectItem value="50" className="text-xs">
                            50
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <span className="tabular-nums">
                      第 {safePage} / {totalPages} 页
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="第一页"
                        disabled={safePage <= 1}
                        onClick={() => setPage(1)}
                      >
                        <ChevronsLeft className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="上一页"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="下一页"
                        disabled={safePage >= totalPages}
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                      >
                        <ChevronRight className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="最后一页"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage(totalPages)}
                      >
                        <ChevronsRight className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {orphanSelected.length > 0 && (
              <div className="flex flex-col gap-2 border-t pt-3">
                {orphanSelected.map((name) => (
                  <div
                    key={name}
                    className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground"
                  >
                    <span className="min-w-0 truncate">
                      <code className="font-mono text-foreground">{name}</code>{" "}
                      所属插件已停用
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => toggleTool(name, false)}
                    >
                      移除
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <Dialog
        open={Boolean(inspectTool)}
        onOpenChange={(open) => {
          if (!open) setInspectTool(null)
        }}
      >
        <DialogContent className="sm:max-w-xl">
          {inspectTool && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="font-mono text-base">
                    {shortToolName(inspectTool)}
                  </DialogTitle>
                  <Badge variant="secondary">
                    {pluginLabel(inspectTool.plugin)}
                  </Badge>
                </div>
                <DialogDescription className="flex items-center gap-2 font-mono text-xs">
                  <span>{inspectTool.name}</span>
                  <button
                    type="button"
                    aria-label="复制完整工具名"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() =>
                      void run((signal) =>
                        copy(inspectTool.name, "inspect-name", signal)
                      )
                    }
                  >
                    {copiedKey === "inspect-name" ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    {copiedKey === "inspect-name" ? "已复制" : "复制"}
                  </button>
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    工具描述
                  </span>
                  <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-foreground">
                    {inspectTool.description || "未提供描述"}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    入参定义（{inspectedParams.length}）
                  </span>
                  {inspectedParams.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                      该工具无需入参。
                    </div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto rounded-lg border">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="h-9 px-3 pl-4 text-left text-xs font-semibold text-muted-foreground">
                              参数名
                            </TableHead>
                            <TableHead className="h-9 px-3 text-left text-xs font-semibold text-muted-foreground">
                              类型
                            </TableHead>
                            <TableHead className="h-9 w-[64px] px-3 text-left text-xs font-semibold text-muted-foreground">
                              必填
                            </TableHead>
                            <TableHead className="h-9 px-3 pr-4 text-left text-xs font-semibold text-muted-foreground">
                              说明
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {inspectedParams.map((param) => (
                            <TableRow key={param.name}>
                              <TableCell className="px-3 py-2.5 pl-4 text-left font-mono text-xs font-medium">
                                {param.name}
                              </TableCell>
                              <TableCell className="px-3 py-2.5 text-left font-mono text-xs text-muted-foreground">
                                {param.type}
                              </TableCell>
                              <TableCell className="px-3 py-2.5 text-left text-xs">
                                {param.required ? (
                                  <span className="font-medium text-foreground">
                                    必填
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    可选
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2.5 pr-4 text-left text-xs whitespace-normal text-muted-foreground">
                                {param.description || "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                <details className="group border-t pt-3">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                    原始 JSON Schema
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5">
                    {JSON.stringify(inspectTool.inputSchema, null, 2)}
                  </pre>
                </details>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default {
  id: "mcp-service",
  apiVersion: 1,
  ownsConfiguration: true,
  pages: [{ id: "service", component: () => <Page /> }],
} satisfies PluginWebModule
