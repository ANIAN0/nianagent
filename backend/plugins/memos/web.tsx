import { useEffect, useRef, useState } from "react"
import { Check, ChevronRight, Copy, Eye, EyeOff, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

export const id = "memos"

type Visibility = "PRIVATE" | "PROTECTED" | "PUBLIC"

type MemosConfig = {
  instanceUrl: string
  defaultVisibility: Visibility
  defaultPageSize: number
  timeoutSeconds: number
  readOnly: boolean
}

type MemosStatus = {
  configured: boolean
  hasCredentials: boolean
  accessToken: string
  credentialSummary: string
  instanceUrl: string
  readOnly: boolean
  connection: {
    state: "unconfigured" | "unknown" | "connected" | "error"
    user: string | null
    checkedAt: string | null
    error: string
  }
}

type TestResult = {
  ok: boolean
  user: string | null
  latencyMs: number
  error: string
}

const defaultConfig: MemosConfig = {
  instanceUrl: "",
  defaultVisibility: "PRIVATE",
  defaultPageSize: 20,
  timeoutSeconds: 30,
  readOnly: false,
}

const normalizeConfig = (raw: unknown): MemosConfig => {
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
  const visibility =
    record.defaultVisibility === "PROTECTED" ||
    record.defaultVisibility === "PUBLIC"
      ? record.defaultVisibility
      : "PRIVATE"
  return {
    instanceUrl:
      typeof record.instanceUrl === "string" ? record.instanceUrl : "",
    defaultVisibility: visibility,
    defaultPageSize:
      typeof record.defaultPageSize === "number" &&
      record.defaultPageSize >= 1 &&
      record.defaultPageSize <= 100
        ? Math.trunc(record.defaultPageSize)
        : 20,
    timeoutSeconds:
      typeof record.timeoutSeconds === "number" &&
      record.timeoutSeconds >= 5 &&
      record.timeoutSeconds <= 120
        ? Math.trunc(record.timeoutSeconds)
        : 30,
    readOnly: Boolean(record.readOnly),
  }
}

const isValidHttpUrl = (raw: string) => {
  const trimmed = raw.trim()
  if (!trimmed) return true
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

const errorText = (error: unknown) =>
  error instanceof Error && error.message.trim()
    ? error.message
    : "操作未确认，请重新读取。"

export function Page() {
  const [status, setStatus] = useState<MemosStatus>()
  const [savedConfig, setSavedConfig] = useState<MemosConfig>(defaultConfig)
  const [instanceUrl, setInstanceUrl] = useState("")
  const [defaultVisibility, setDefaultVisibility] =
    useState<Visibility>("PRIVATE")
  const [defaultPageSize, setDefaultPageSize] = useState("20")
  const [timeoutSeconds, setTimeoutSeconds] = useState("30")
  const [readOnly, setReadOnly] = useState(false)
  const [tokenInput, setTokenInput] = useState("")
  const [tokenEdited, setTokenEdited] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  const busy = useRef(false)

  const applyDraft = (cfg: MemosConfig, nextStatus: MemosStatus) => {
    setSavedConfig(cfg)
    setInstanceUrl(cfg.instanceUrl)
    setDefaultVisibility(cfg.defaultVisibility)
    setDefaultPageSize(String(cfg.defaultPageSize))
    setTimeoutSeconds(String(cfg.timeoutSeconds))
    setReadOnly(cfg.readOnly)
    setTokenInput(nextStatus.accessToken || "")
    setTokenEdited(false)
    setStatus(nextStatus)
  }

  const fetchAll = async (signal: AbortSignal) => {
    const [plugins, statusRes] = await Promise.all([
      rpcCall("pluginList", {}, signal),
      callPlugin<{ value: MemosStatus }>(id, "status", {}, undefined, signal),
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

  const invalidUrl = !isValidHttpUrl(instanceUrl)
  const invalidPageSize =
    !/^\d+$/.test(defaultPageSize) ||
    Number(defaultPageSize) < 1 ||
    Number(defaultPageSize) > 100
  const invalidTimeout =
    !/^\d+$/.test(timeoutSeconds) ||
    Number(timeoutSeconds) < 5 ||
    Number(timeoutSeconds) > 120
  const hasInvalid = invalidUrl || invalidPageSize || invalidTimeout

  const nextConfig: MemosConfig = {
    instanceUrl: instanceUrl.trim(),
    defaultVisibility,
    defaultPageSize: Number(defaultPageSize) || savedConfig.defaultPageSize,
    timeoutSeconds: Number(timeoutSeconds) || savedConfig.timeoutSeconds,
    readOnly,
  }

  const addressDirty = nextConfig.instanceUrl !== savedConfig.instanceUrl
  const configDirty =
    addressDirty ||
    nextConfig.defaultVisibility !== savedConfig.defaultVisibility ||
    nextConfig.defaultPageSize !== savedConfig.defaultPageSize ||
    nextConfig.timeoutSeconds !== savedConfig.timeoutSeconds ||
    nextConfig.readOnly !== savedConfig.readOnly
  const savedToken = status?.accessToken || ""
  const trimmedToken = tokenInput.trim()
  const tokenDirty = addressDirty
    ? tokenEdited && Boolean(trimmedToken)
    : trimmedToken !== savedToken
  const canTest = addressDirty ? tokenDirty : Boolean(trimmedToken)
  const dirty = configDirty || tokenDirty

  const persistChanges = async (signal: AbortSignal) => {
    if (configDirty) {
      const plugins = await rpcCall("pluginList", {}, signal)
      const current = plugins.find((item) => item.id === id)
      if (!current) throw new Error("Memos 插件当前不可用，请刷新后重试。")
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
    }
    if (tokenDirty) {
      if (trimmedToken) {
        await callPlugin<{ value: MemosStatus }>(
          id,
          "setCredentials",
          { accessToken: trimmedToken },
          undefined,
          signal
        )
      } else {
        await callPlugin<{ value: MemosStatus }>(
          id,
          "clearCredentials",
          {},
          undefined,
          signal
        )
      }
    }
    pluginsChanged()
    const fresh = await fetchAll(signal)
    if (!signal.aborted) applyDraft(fresh.cfg, fresh.status)
  }

  const saveAndOptionallyTest = (testAfter: boolean) => {
    void run(async (signal) => {
      if (dirty) await persistChanges(signal)
      if (!testAfter) {
        notifyToast("Memos 配置已保存", { tone: "success" })
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
        notifyToast(
          `连接成功${res.value.user ? `（${res.value.user}）` : ""} · ${res.value.latencyMs}ms`,
          { tone: "success" }
        )
      } else {
        notifyToast(res.value.error || "连接失败", { tone: "error" })
      }
    })
  }

  const copyAddress = () => {
    const url = (status?.instanceUrl || instanceUrl).trim()
    if (!url) return
    void run(async (signal) => {
      await navigator.clipboard.writeText(url)
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
        : status?.configured
          ? "待测试"
          : "未配置"
  const stateMeta = [conn?.user, status?.readOnly ? "只读" : ""]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-label="Memos 服务配置">
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
                {status.instanceUrl && (
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
                  disabled={pending || hasInvalid || !canTest}
                  onClick={() => saveAndOptionallyTest(true)}
                >
                  <RefreshCw className="size-3.5" />
                  {dirty ? "保存并测试" : "测试连接"}
                </Button>
              </div>
            </div>

            <div className="grid gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-center">
              <label
                htmlFor="memos-instance-url"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                服务地址
              </label>
              <div className="flex flex-col gap-1">
                <Input
                  id="memos-instance-url"
                  className="h-8 font-mono text-xs"
                  value={instanceUrl}
                  placeholder="http://localhost:5230"
                  aria-invalid={invalidUrl}
                  onChange={(e) => setInstanceUrl(e.target.value)}
                />
                {invalidUrl && (
                  <span className="text-xs text-destructive">
                    请输入有效的 http:// 或 https:// 地址
                  </span>
                )}
              </div>

              <label
                htmlFor="memos-token"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                Access Token
              </label>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  id="memos-token"
                  type={showToken ? "text" : "password"}
                  className="h-8 min-w-0 flex-1 font-mono text-xs"
                  value={addressDirty && !tokenEdited ? "" : tokenInput}
                  placeholder={
                    addressDirty
                      ? "输入新实例的 Access Token"
                      : "输入 Memos Personal Access Token"
                  }
                  onChange={(e) => {
                    setTokenInput(e.target.value)
                    setTokenEdited(true)
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 w-8 shrink-0 px-0"
                  aria-label={
                    showToken ? "隐藏 Access Token" : "显示 Access Token"
                  }
                  onClick={() => setShowToken((prev) => !prev)}
                >
                  {showToken ? (
                    <EyeOff className="size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                </Button>
              </div>

              <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
                只读模式
              </span>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  开启后拒绝所有创建、修改、删除及附件写入操作
                </span>
                <Switch
                  aria-label="只读模式"
                  checked={readOnly}
                  onCheckedChange={setReadOnly}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              {dirty && (
                <span className="mr-auto text-xs text-muted-foreground">
                  有未保存的修改
                </span>
              )}
              <Button
                className="h-8 text-xs"
                disabled={pending || !dirty || hasInvalid}
                onClick={() => saveAndOptionallyTest(false)}
              >
                {pending ? "保存中…" : "保存"}
              </Button>
            </div>
          </section>

          <details className="group rounded-xl border bg-card px-4 py-3 text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-foreground select-none [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              <span>高级参数</span>
            </summary>
            <div className="mt-3 grid gap-x-4 gap-y-3 border-t pt-3 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-center">
              <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
                默认可见性
              </span>
              <Select
                value={defaultVisibility}
                onValueChange={(value) =>
                  setDefaultVisibility(value as Visibility)
                }
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="PRIVATE">仅自己（PRIVATE）</SelectItem>
                  <SelectItem value="PROTECTED">
                    登录用户（PROTECTED）
                  </SelectItem>
                  <SelectItem value="PUBLIC">公开（PUBLIC）</SelectItem>
                </SelectContent>
              </Select>

              <label
                htmlFor="memos-page-size"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                默认每页条数
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="memos-page-size"
                  type="number"
                  min={1}
                  max={100}
                  className="h-8 w-28 font-mono text-xs"
                  value={defaultPageSize}
                  aria-invalid={invalidPageSize}
                  onChange={(e) => setDefaultPageSize(e.target.value)}
                />
                {invalidPageSize && (
                  <span className="text-xs text-destructive">
                    请输入 1–100 之间的整数
                  </span>
                )}
              </div>

              <label
                htmlFor="memos-timeout"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                请求超时
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="memos-timeout"
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
