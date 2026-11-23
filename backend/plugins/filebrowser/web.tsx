import { useEffect, useRef, useState } from "react"
import {
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react"
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

export const id = "filebrowser"

type ShareUnit = "seconds" | "minutes" | "hours" | "days"

type FileBrowserConfig = {
  instanceUrl: string
  rootPrefix: string
  defaultShareExpires: number
  defaultShareUnit: ShareUnit
  timeoutSeconds: number
  readOnly: boolean
}

type FileBrowserStatus = {
  configured: boolean
  hasCredentials: boolean
  username: string
  password: string
  credentialSummary: string
  instanceUrl: string
  rootPrefix: string
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

const defaultConfig: FileBrowserConfig = {
  instanceUrl: "",
  rootPrefix: "/",
  defaultShareExpires: 24,
  defaultShareUnit: "hours",
  timeoutSeconds: 60,
  readOnly: false,
}

const normalizeConfig = (raw: unknown): FileBrowserConfig => {
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
  const unit =
    record.defaultShareUnit === "seconds" ||
    record.defaultShareUnit === "minutes" ||
    record.defaultShareUnit === "days"
      ? record.defaultShareUnit
      : "hours"
  return {
    instanceUrl:
      typeof record.instanceUrl === "string" ? record.instanceUrl : "",
    rootPrefix:
      typeof record.rootPrefix === "string" && record.rootPrefix.trim()
        ? record.rootPrefix
        : "/",
    defaultShareExpires:
      typeof record.defaultShareExpires === "number" &&
      record.defaultShareExpires >= 1 &&
      record.defaultShareExpires <= 3650
        ? Math.trunc(record.defaultShareExpires)
        : 24,
    defaultShareUnit: unit,
    timeoutSeconds:
      typeof record.timeoutSeconds === "number" &&
      record.timeoutSeconds >= 5 &&
      record.timeoutSeconds <= 300
        ? Math.trunc(record.timeoutSeconds)
        : 60,
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
  const [status, setStatus] = useState<FileBrowserStatus>()
  const [savedConfig, setSavedConfig] =
    useState<FileBrowserConfig>(defaultConfig)
  const [instanceUrl, setInstanceUrl] = useState("")
  const [rootPrefix, setRootPrefix] = useState("/")
  const [defaultShareExpires, setDefaultShareExpires] = useState("24")
  const [defaultShareUnit, setDefaultShareUnit] = useState<ShareUnit>("hours")
  const [timeoutSeconds, setTimeoutSeconds] = useState("60")
  const [readOnly, setReadOnly] = useState(false)
  const [usernameInput, setUsernameInput] = useState("")
  const [passwordInput, setPasswordInput] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  const busy = useRef(false)

  const applyDraft = (
    cfg: FileBrowserConfig,
    nextStatus: FileBrowserStatus
  ) => {
    setSavedConfig(cfg)
    setInstanceUrl(cfg.instanceUrl)
    setRootPrefix(cfg.rootPrefix)
    setDefaultShareExpires(String(cfg.defaultShareExpires))
    setDefaultShareUnit(cfg.defaultShareUnit)
    setTimeoutSeconds(String(cfg.timeoutSeconds))
    setReadOnly(cfg.readOnly)
    setUsernameInput(nextStatus.username || "")
    setPasswordInput(nextStatus.password || "")
    setStatus(nextStatus)
  }

  const fetchAll = async (signal: AbortSignal) => {
    const [plugins, statusRes] = await Promise.all([
      rpcCall("pluginList", {}, signal),
      callPlugin<{ value: FileBrowserStatus }>(
        id,
        "status",
        {},
        undefined,
        signal
      ),
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
  const invalidExpires =
    !/^\d+$/.test(defaultShareExpires) ||
    Number(defaultShareExpires) < 1 ||
    Number(defaultShareExpires) > 3650
  const invalidTimeout =
    !/^\d+$/.test(timeoutSeconds) ||
    Number(timeoutSeconds) < 5 ||
    Number(timeoutSeconds) > 300
  const partialCreds =
    (usernameInput.trim().length > 0) !== (passwordInput.length > 0)
  const hasInvalid =
    invalidUrl || invalidExpires || invalidTimeout || partialCreds

  const nextConfig: FileBrowserConfig = {
    instanceUrl: instanceUrl.trim(),
    rootPrefix: rootPrefix.trim() || "/",
    defaultShareExpires:
      Number(defaultShareExpires) || savedConfig.defaultShareExpires,
    defaultShareUnit,
    timeoutSeconds: Number(timeoutSeconds) || savedConfig.timeoutSeconds,
    readOnly,
  }

  const configDirty =
    nextConfig.instanceUrl !== savedConfig.instanceUrl ||
    nextConfig.rootPrefix !== savedConfig.rootPrefix ||
    nextConfig.defaultShareExpires !== savedConfig.defaultShareExpires ||
    nextConfig.defaultShareUnit !== savedConfig.defaultShareUnit ||
    nextConfig.timeoutSeconds !== savedConfig.timeoutSeconds ||
    nextConfig.readOnly !== savedConfig.readOnly
  const savedUsername = status?.username || ""
  const savedPassword = status?.password || ""
  const trimmedUsername = usernameInput.trim()
  const credsDirty =
    trimmedUsername !== savedUsername || passwordInput !== savedPassword
  const dirty = configDirty || credsDirty

  const persistChanges = async (signal: AbortSignal) => {
    if (configDirty) {
      const plugins = await rpcCall("pluginList", {}, signal)
      const current = plugins.find((item) => item.id === id)
      if (!current)
        throw new Error("FileBrowser 插件当前不可用，请刷新后重试。")
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
    if (credsDirty) {
      if (trimmedUsername && passwordInput) {
        await callPlugin<{ value: FileBrowserStatus }>(
          id,
          "setCredentials",
          { username: trimmedUsername, password: passwordInput },
          undefined,
          signal
        )
      } else {
        await callPlugin<{ value: FileBrowserStatus }>(
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
        notifyToast("FileBrowser 配置已保存", { tone: "success" })
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
          `登录成功${res.value.user ? `（${res.value.user}）` : ""} · ${res.value.latencyMs}ms`,
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
    <div
      className="flex min-w-0 flex-col gap-4"
      aria-label="FileBrowser 服务配置"
    >
      <Alert>
        <AlertTitle>仅用于连接已有 FileBrowser 实例</AlertTitle>
        <AlertDescription>
          <p>
            上游已归档，停止缺陷与安全修复。已用官方最终版 v2.63.23 验证账号密码登录、目录读取和下载。
            测试连接只检查登录，无法确认实例版本或各项文件权限。
          </p>
        </AlertDescription>
      </Alert>
      {error && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {conn?.state === "error" && conn.error && (
        <Alert>
          <AlertTitle>连接探测失败</AlertTitle>
          <AlertDescription className="break-all">{conn.error}</AlertDescription>
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
                  disabled={
                    pending ||
                    hasInvalid ||
                    (!status.configured && !dirty)
                  }
                  onClick={() => saveAndOptionallyTest(true)}
                >
                  <RefreshCw className="size-3.5" />
                  {dirty ? "保存并测试" : "测试连接"}
                </Button>
              </div>
            </div>

            <div className="grid gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-center">
              <label
                htmlFor="fb-instance-url"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                服务地址
              </label>
              <div className="flex flex-col gap-1">
                <Input
                  id="fb-instance-url"
                  className="h-8 font-mono text-xs"
                  value={instanceUrl}
                  placeholder="https://files.example.com"
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
                htmlFor="fb-username"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                登录凭据
              </label>
              <div className="flex flex-col gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
                  <Input
                    id="fb-username"
                    className="h-8 min-w-0 flex-1 text-xs"
                    value={usernameInput}
                    placeholder="用户名"
                    aria-invalid={partialCreds}
                    onChange={(e) => setUsernameInput(e.target.value)}
                  />
                  <Input
                    id="fb-password"
                    type={showPassword ? "text" : "password"}
                    className="h-8 min-w-0 flex-1 font-mono text-xs"
                    value={passwordInput}
                    placeholder="密码"
                    aria-invalid={partialCreds}
                    onChange={(e) => setPasswordInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-8 shrink-0 px-0"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </Button>
                </div>
                {partialCreds && (
                  <span className="text-xs text-destructive">
                    请同时填写用户名和密码
                  </span>
                )}
              </div>

              <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
                只读模式
              </span>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  开启后拒绝所有创建、修改、删除、上传、下载和分享写入
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
              <label
                htmlFor="fb-root-prefix"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                远程根路径
              </label>
              <Input
                id="fb-root-prefix"
                className="h-8 font-mono text-xs"
                value={rootPrefix}
                placeholder="/"
                onChange={(e) => setRootPrefix(e.target.value)}
              />

              <label
                htmlFor="fb-share-expires"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                默认分享时长
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="fb-share-expires"
                  type="number"
                  min={1}
                  max={3650}
                  className="h-8 w-28 font-mono text-xs"
                  value={defaultShareExpires}
                  aria-invalid={invalidExpires}
                  onChange={(e) => setDefaultShareExpires(e.target.value)}
                />
                <Select
                  value={defaultShareUnit}
                  onValueChange={(value) =>
                    setDefaultShareUnit(value as ShareUnit)
                  }
                >
                  <SelectTrigger className="h-8 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="seconds">秒</SelectItem>
                    <SelectItem value="minutes">分钟</SelectItem>
                    <SelectItem value="hours">小时</SelectItem>
                    <SelectItem value="days">天</SelectItem>
                  </SelectContent>
                </Select>
                {invalidExpires && (
                  <span className="text-xs text-destructive">
                    请输入 1–3650 之间的整数
                  </span>
                )}
              </div>

              <label
                htmlFor="fb-timeout"
                className="text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                请求超时
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="fb-timeout"
                  type="number"
                  min={5}
                  max={300}
                  className="h-8 w-28 font-mono text-xs"
                  value={timeoutSeconds}
                  aria-invalid={invalidTimeout}
                  onChange={(e) => setTimeoutSeconds(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">秒</span>
                {invalidTimeout && (
                  <span className="text-xs text-destructive">
                    请输入 5–300 之间的整数
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
