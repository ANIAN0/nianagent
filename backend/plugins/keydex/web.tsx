import { useEffect, useRef, useState } from "react"
import { Check, ChevronRight, Copy, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { notifyToast } from "@/components/ui/notification-toast"
import {
  callPlugin,
  pluginsChanged,
  subscribePluginEvent,
} from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import { rpcCall } from "@/lib/rpc/client"

export const id = "keydex"

type KeydexConfig = {
  installDir: string
  baseUrl: string
  timeoutSeconds: number
  readOnly: boolean
}

type KeydexToolItem = {
  name: string
  description: string
  effect: "read" | "write"
  destructive: boolean
  enabled: boolean
}

type KeydexProjectSummary = {
  key: string
  name: string
}

type KeydexStatus = {
  installDir: string
  baseUrl: string
  timeoutSeconds: number
  readOnly: boolean
  connection: {
    state: "unknown" | "connected" | "error"
    baseUrl: string
    source: "none" | "configured" | "discovered"
    pid: number | null
    identityUser: string | null
    pmState: string
    pmUser: string | null
    projectCount: number
    projects: KeydexProjectSummary[]
    checkedAt: string | null
    error: string
  }
  tools: KeydexToolItem[]
}

type TestResult = {
  ok: boolean
  baseUrl: string
  identityUser: string | null
  pmState: string
  pmUser: string | null
  projectCount: number
  latencyMs: number
  error: string
}

const defaultConfig: KeydexConfig = {
  installDir: "D:\\tool\\Keydex",
  baseUrl: "",
  timeoutSeconds: 30,
  readOnly: false,
}

const normalizeConfig = (raw: unknown): KeydexConfig => {
  let parsed = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return defaultConfig
    }
  }
  if (!parsed || typeof parsed !== "object") return defaultConfig
  const record = parsed as Record<string, unknown>
  return {
    installDir:
      typeof record.installDir === "string"
        ? record.installDir
        : defaultConfig.installDir,
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : "",
    timeoutSeconds:
      typeof record.timeoutSeconds === "number" &&
      record.timeoutSeconds >= 5 &&
      record.timeoutSeconds <= 120
        ? Math.trunc(record.timeoutSeconds)
        : 30,
    readOnly: Boolean(record.readOnly),
  }
}

const isValidLoopbackUrl = (raw: string) => {
  const trimmed = raw.trim()
  if (!trimmed) return true
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return false
    const host = parsed.hostname.toLowerCase()
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]"
    )
  } catch {
    return false
  }
}

const errorText = (error: unknown) =>
  error instanceof Error && error.message.trim()
    ? error.message
    : "操作未确认，请重新读取。"

export function Page() {
  const [status, setStatus] = useState<KeydexStatus>()
  const [savedConfig, setSavedConfig] = useState<KeydexConfig>(defaultConfig)
  const [installDir, setInstallDir] = useState(defaultConfig.installDir)
  const [baseUrl, setBaseUrl] = useState("")
  const [timeoutSeconds, setTimeoutSeconds] = useState("30")
  const [readOnly, setReadOnly] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  const busy = useRef(false)

  const applyDraft = (cfg: KeydexConfig, nextStatus: KeydexStatus) => {
    setSavedConfig(cfg)
    setInstallDir(cfg.installDir)
    setBaseUrl(cfg.baseUrl)
    setTimeoutSeconds(String(cfg.timeoutSeconds))
    setReadOnly(cfg.readOnly)
    setStatus(nextStatus)
  }

  const fetchAll = async (signal: AbortSignal) => {
    const [plugins, statusRes] = await Promise.all([
      rpcCall("pluginList", {}, signal),
      callPlugin<{ value: KeydexStatus }>(id, "status", {}, undefined, signal),
    ])
    const entry = plugins.find((item) => item.id === id)
    return {
      cfg: normalizeConfig(entry?.configuration),
      status: statusRes.value,
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    const load = () => {
      void fetchAll(controller.signal)
        .then(({ cfg, status: nextStatus }) => {
          if (!controller.signal.aborted) {
            applyDraft(cfg, nextStatus)
            setError("")
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(errorText(reason))
        })
    }
    load()
    const off = subscribePluginEvent(id, "status-changed", () => {
      if (!busy.current) load()
    })
    return () => {
      controller.abort()
      lifetime.current = null
      off()
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
      if (!controller.signal.aborted) setError(errorText(reason))
    } finally {
      busy.current = false
      if (!controller.signal.aborted) setPending(false)
    }
  }

  const invalidUrl = !isValidLoopbackUrl(baseUrl)
  const invalidTimeout =
    !/^\d+$/.test(timeoutSeconds) ||
    Number(timeoutSeconds) < 5 ||
    Number(timeoutSeconds) > 120
  const hasInvalid = invalidUrl || invalidTimeout

  const nextConfig: KeydexConfig = {
    installDir: installDir.trim(),
    baseUrl: baseUrl.trim(),
    timeoutSeconds: Number(timeoutSeconds) || savedConfig.timeoutSeconds,
    readOnly,
  }

  const dirty =
    nextConfig.installDir !== savedConfig.installDir ||
    nextConfig.baseUrl !== savedConfig.baseUrl ||
    nextConfig.timeoutSeconds !== savedConfig.timeoutSeconds ||
    nextConfig.readOnly !== savedConfig.readOnly

  const persistChanges = async (signal: AbortSignal) => {
    const plugins = await rpcCall("pluginList", {}, signal)
    const current = plugins.find((item) => item.id === id)
    if (!current) throw new Error("Keydex 插件当前不可用，请刷新后重试。")
    await rpcCall(
      "pluginConfigure",
      {
        id,
        revision: current.revision,
        enabled: current.enabled,
        configuration: JSON.stringify(nextConfig),
      },
      signal
    )
    pluginsChanged()
    const fresh = await fetchAll(signal)
    if (!signal.aborted) applyDraft(fresh.cfg, fresh.status)
  }

  const saveAndOptionallyTest = (testAfter: boolean) => {
    void run(async (signal) => {
      if (dirty) await persistChanges(signal)
      if (!testAfter) {
        notifyToast("Keydex 配置已保存", { tone: "success" })
        return
      }
      const res = await callPlugin<{ value: TestResult }>(
        id,
        "testConnection",
        {},
        undefined,
        signal
      )
      const fresh = await fetchAll(signal)
      if (!signal.aborted) applyDraft(fresh.cfg, fresh.status)
      pluginsChanged()
      if (res.value.ok) {
        const user = res.value.pmUser || res.value.identityUser
        notifyToast(
          `连接成功${user ? `（${user}）` : ""} · ${res.value.projectCount} 个 PM 项目 · ${res.value.latencyMs}ms`,
          { tone: "success" }
        )
      } else {
        notifyToast(res.value.error || "连接失败", { tone: "error" })
      }
    })
  }

  const activeAddress = (status?.connection.baseUrl || baseUrl).trim()

  const copyAddress = () => {
    if (!activeAddress) return
    void run(async (signal) => {
      await navigator.clipboard.writeText(activeAddress)
      if (!signal.aborted) {
        setCopied(true)
        notifyToast("服务地址已复制", { tone: "success" })
        window.setTimeout(() => setCopied(false), 1600)
      }
    })
  }

  const conn = status?.connection
  const dotClass =
    conn?.state === "connected"
      ? "size-2 rounded-full bg-emerald-500"
      : conn?.state === "error"
        ? "size-2 rounded-full bg-destructive"
        : "size-2 rounded-full bg-muted-foreground/40"
  const stateLabel =
    conn?.state === "connected"
      ? "已连接"
      : conn?.state === "error"
        ? "连接失败"
        : "待探测"
  const stateMeta = [
    conn?.baseUrl,
    conn?.pmUser || conn?.identityUser,
    conn?.state === "connected" ? `PM: ${conn.pmState}` : "",
    status?.readOnly ? "只读" : "",
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-label="Keydex 服务配置">
      {error && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {conn?.state === "error" && conn.error && (
        <Alert>
          <AlertTitle>连接探测失败</AlertTitle>
          <AlertDescription className="break-all">
            {conn.error}
          </AlertDescription>
        </Alert>
      )}
      {!status ? (
        <Skeleton className="h-44 w-full rounded-xl" />
      ) : (
        <>
          <section className="flex flex-col gap-4 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span aria-hidden="true" className={dotClass} />
                <span className="text-sm font-medium">{stateLabel}</span>
                {stateMeta && (
                  <span className="truncate text-xs text-muted-foreground">
                    {stateMeta}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeAddress && (
                  <Button
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={pending}
                    onClick={copyAddress}
                  >
                    {copied ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copied ? "已复制" : "复制地址"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={pending || hasInvalid}
                  onClick={() => saveAndOptionallyTest(true)}
                >
                  <RefreshCw className="size-3.5" />
                  {dirty ? "保存并探测" : "探测连接"}
                </Button>
                {dirty && (
                  <Button
                    className="h-8 text-xs"
                    disabled={pending || hasInvalid}
                    onClick={() => saveAndOptionallyTest(false)}
                  >
                    保存配置
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-[100px_minmax(0,1fr)] sm:items-center">
              <label
                htmlFor="keydex-install-dir"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                安装目录
              </label>
              <Input
                id="keydex-install-dir"
                className="h-8 font-mono text-xs"
                value={installDir}
                placeholder="D:\tool\Keydex"
                onChange={(e) => setInstallDir(e.target.value)}
              />

              <label
                htmlFor="keydex-base-url"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                固定地址
              </label>
              <div className="flex flex-col gap-1">
                <Input
                  id="keydex-base-url"
                  className="h-8 font-mono text-xs"
                  value={baseUrl}
                  placeholder="留空自动发现运行中的 Keydex 端口"
                  aria-invalid={invalidUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                {invalidUrl && (
                  <span className="text-xs text-destructive">
                    仅允许留空或填写本机回环地址（http://127.0.0.1:端口）
                  </span>
                )}
              </div>

              <label
                htmlFor="keydex-readonly"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                只读模式
              </label>
              <div className="flex items-center gap-2">
                <Switch
                  id="keydex-readonly"
                  checked={readOnly}
                  onCheckedChange={setReadOnly}
                />
                <span className="text-xs text-muted-foreground">
                  开启后拒绝创建、修改、状态流转和评论等写入操作
                </span>
              </div>

              <label
                htmlFor="keydex-timeout"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                请求超时
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="keydex-timeout"
                  type="number"
                  min={5}
                  max={120}
                  className="h-8 w-28 font-mono text-xs"
                  value={timeoutSeconds}
                  aria-invalid={invalidTimeout}
                  onChange={(e) => setTimeoutSeconds(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">秒</span>
                {invalidTimeout && (
                  <span className="text-xs text-destructive">
                    请输入 5–120 之间的整数
                  </span>
                )}
              </div>
            </div>
          </section>

          {conn && conn.projects.length > 0 && (
            <section className="flex flex-col gap-2 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  可见 PM 项目（{conn.projectCount}）
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {conn.projects.map((project) => (
                  <Badge
                    key={project.key}
                    variant="secondary"
                    className="font-normal"
                  >
                    {project.name}
                    <span className="ml-1 font-mono text-[11px] opacity-70">
                      {project.key}
                    </span>
                  </Badge>
                ))}
              </div>
            </section>
          )}

          <details className="group rounded-xl border bg-card">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-xs font-medium text-muted-foreground select-none">
              <span>可用工具（{status.tools.length}）</span>
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            </summary>
            <div className="flex flex-col divide-y border-t px-4">
              {status.tools.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-start justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-medium">
                      {tool.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {tool.description}
                    </div>
                  </div>
                  <Badge
                    variant={tool.enabled ? "secondary" : "outline"}
                    className="shrink-0 text-[11px]"
                  >
                    {tool.effect === "read"
                      ? "只读"
                      : tool.enabled
                        ? "写入"
                        : "已禁用"}
                  </Badge>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  )
}

const plugin: PluginWebModule = {
  id,
  apiVersion: 1,
  ownsConfiguration: true,
  pages: [{ id: "service", component: () => <Page /> }],
}

export default plugin
