import { useEffect, useRef, useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { Check, ExternalLink, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { notifyToast } from "@/components/ui/notification-toast"
import {
  callPlugin,
  pluginsChanged,
  subscribePluginEvent,
} from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import { rpcCall } from "@/lib/rpc/client"
import type { OpenCliAction, OpenCliService, OpenCliStatus } from "./types"
export type { OpenCliStatus } from "./types"
export const id = "opencli"

type OpenCliConfig = {
  profile: string
  background: boolean
}

type OpenCliConfigState = {
  revision: number
  enabled: boolean
  config: OpenCliConfig
}

const defaultConfig: OpenCliConfig = {
  profile: "",
  background: false,
}

const normalizeConfig = (raw: unknown): OpenCliConfig => {
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
    profile: typeof record.profile === "string" ? record.profile : "",
    background: Boolean(record.background),
  }
}

const readConfig = async (
  signal?: AbortSignal
): Promise<OpenCliConfigState> => {
  const plugins = await rpcCall("pluginList", {}, signal)
  const item = plugins.find((entry) => entry.id === id)
  if (!item) throw new Error("OpenCLI 插件当前不可用，请刷新后重试。")
  return {
    revision: item.revision,
    enabled: item.enabled,
    config: normalizeConfig(item.configuration),
  }
}

const saveConfig = async (
  current: OpenCliConfigState,
  next: OpenCliConfig
): Promise<OpenCliConfigState> => {
  const plugin = await rpcCall("pluginConfigure", {
    id,
    revision: current.revision,
    enabled: current.enabled,
    configuration: JSON.stringify(next),
  })
  pluginsChanged()
  return {
    revision: plugin.revision,
    enabled: plugin.enabled,
    config: normalizeConfig(plugin.configuration),
  }
}

const service: OpenCliService = {
  read: async (signal) =>
    (
      await callPlugin<{ value: OpenCliStatus }>(
        id,
        "status",
        {},
        undefined,
        signal
      )
    ).value,
  manage: async (action, input) =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<OpenCliService["manage"]>>
      }>(id, action, input)
    ).value,
}

const names: Record<OpenCliAction, string> = {
  install: "安装",
  uninstall: "卸载",
  upgrade: "升级",
  start: "启动",
  stop: "停止",
}

const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : "OpenCLI 操作未确认，请重新读取。"

function StatusDot({ tone }: { tone: "ok" | "idle" | "error" }) {
  return (
    <span
      aria-hidden="true"
      className={
        tone === "ok"
          ? "size-2 shrink-0 rounded-full bg-emerald-500"
          : tone === "error"
            ? "size-2 shrink-0 rounded-full bg-destructive"
            : "size-2 shrink-0 rounded-full bg-muted-foreground/40"
      }
    />
  )
}

export function Page({
  service: source = service,
}: {
  service?: OpenCliService
}) {
  const [value, setValue] = useState<OpenCliStatus>()
  const [configState, setConfigState] = useState<OpenCliConfigState>()
  const [savingConfig, setSavingConfig] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState<OpenCliAction | "status" | "">("")
  const mounted = useRef(false)
  const accepting = useRef(false)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    const syncStatus = () => {
      if (controller.signal.aborted) return
      void source
        .read(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setValue(result)
            setError("")
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(errorText(reason))
        })
    }
    const syncConfig = () => {
      if (controller.signal.aborted) return
      void readConfig(controller.signal)
        .then((cfg) => {
          if (!controller.signal.aborted) setConfigState(cfg)
        })
        .catch(() => {})
    }
    void Promise.all([
      source.read(controller.signal),
      readConfig(controller.signal).catch(() => undefined),
    ])
      .then(([result, cfg]) => {
        if (!controller.signal.aborted) {
          setValue(result)
          setConfigState(cfg)
          setError("")
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorText(reason))
      })
    // 常驻订阅宿主事件，避免运行态切换瞬间错过完成通知
    const unsubscribe = subscribePluginEvent(id, "status-changed", syncStatus)
    window.addEventListener("moon:plugins-changed", syncConfig)
    return () => {
      mounted.current = false
      controller.abort()
      unsubscribe()
      window.removeEventListener("moon:plugins-changed", syncConfig)
    }
  }, [source])

  const running = value?.operation?.state === "running"
  useEffect(() => {
    if (!running || isTauri()) return
    const controller = new AbortController()
    let reading = false
    const sync = () => {
      if (reading || controller.signal.aborted) return
      reading = true
      void source
        .read(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setValue(result)
            setError("")
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(errorText(reason))
        })
        .finally(() => {
          reading = false
        })
    }
    const timer = setInterval(sync, 1000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [source, running])

  const read = async () => {
    setPending("status")
    try {
      const [result, cfg] = await Promise.all([
        source.read(),
        readConfig().catch(() => configState),
      ])
      if (mounted.current) {
        setValue(result)
        setConfigState(cfg)
        setError("")
        notifyToast("状态已刷新", { tone: "success" })
      }
    } catch (reason) {
      if (mounted.current) setError(errorText(reason))
    } finally {
      if (mounted.current) setPending("")
    }
  }

  const updateConfig = async (patch: Partial<OpenCliConfig>) => {
    if (!configState || savingConfig || accepting.current || running || pending)
      return
    const next = { ...configState.config, ...patch }
    const restartingNeeded = value?.daemon.owned
    setSavingConfig(true)
    setError("")
    try {
      const saved = await saveConfig(configState, next)
      if (mounted.current) {
        setConfigState(saved)
        const message =
          "profile" in patch
            ? patch.profile
              ? "默认连接已更新"
              : "已清除默认连接"
            : "后台窗口模式已更新"
        notifyToast(
          restartingNeeded ? message + "，请重新启动 OpenCLI 后台。" : message,
          { tone: "success" }
        )
      }
    } catch (reason) {
      if (mounted.current) setError(errorText(reason))
    } finally {
      if (mounted.current) setSavingConfig(false)
    }
  }

  const manage = async (action: OpenCliAction) => {
    if (accepting.current || running || pending || savingConfig || !value)
      return
    accepting.current = true
    setPending(action)
    setError("")
    try {
      const result = await source.manage(
        action,
        value.daemon.pid && value.daemon.version
          ? {
              expectedDaemonPid: value.daemon.pid,
              expectedDaemonVersion: value.daemon.version,
            }
          : {}
      )
      if (!mounted.current) return
      setValue((previous) =>
        previous ? { ...previous, operation: result.operation } : previous
      )
      const current = await source.read()
      if (mounted.current) setValue(current)
    } catch (reason) {
      if (mounted.current) setError(errorText(reason))
    } finally {
      accepting.current = false
      if (mounted.current) setPending("")
    }
  }

  return (
    <OpenCliConnectionView
      value={value}
      config={configState?.config}
      configurationReady={!!configState}
      savingConfig={savingConfig}
      error={error}
      pending={pending}
      onRead={() => void read()}
      onAction={(action) => void manage(action)}
      onConfigure={(patch) => void updateConfig(patch)}
    />
  )
}

function ManualProfileForm({
  currentProfile,
  savingConfig,
  onSave,
}: {
  currentProfile: string
  savingConfig: boolean
  onSave: (profile: string) => void
}) {
  const [draft, setDraft] = useState(currentProfile)
  const dirty = draft.trim() !== currentProfile
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <Input
        aria-label="默认连接 ID 或别名"
        className="min-w-[180px] flex-1 font-mono text-xs"
        placeholder="手动输入连接 ID 或别名（可选）"
        value={draft}
        disabled={savingConfig}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button
        variant="outline"
        className="text-xs"
        disabled={savingConfig || !dirty}
        onClick={() => onSave(draft.trim())}
      >
        保存
      </Button>
      {currentProfile && (
        <Button
          variant="outline"
          className="text-xs"
          disabled={savingConfig}
          onClick={() => onSave("")}
        >
          清除默认
        </Button>
      )}
    </div>
  )
}

export function OpenCliConnectionView({
  value,
  config = defaultConfig,
  configurationReady = true,
  savingConfig = false,
  error,
  pending = "",
  onRead,
  onAction,
  onConfigure,
}: {
  value?: OpenCliStatus
  config?: OpenCliConfig
  configurationReady?: boolean
  savingConfig?: boolean
  error: string
  pending?: OpenCliAction | "status" | ""
  onRead: () => void
  onAction: (action: OpenCliAction) => void
  onConfigure?: (patch: Partial<OpenCliConfig>) => void
}) {
  const installation = value?.installation
  const running = value?.operation?.state === "running"
  const disabled = !!pending || running || savingConfig || !value
  const configurationDisabled = disabled || !configurationReady
  const installed = installation?.state === "installed"
  const operation = value?.operation
  const version = operation?.targetVersion || installation?.latestVersion

  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm">
      {error && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          {!value && (
            <Button
              variant="outline"
              size="sm"
              className="col-start-1 mt-2 justify-self-start"
              disabled={pending === "status"}
              onClick={onRead}
            >
              {pending === "status" ? "刷新中…" : "重试"}
            </Button>
          )}
        </Alert>
      )}
      {!value ? (
        !error && (
          <div
            className="flex flex-col gap-4"
            aria-label="正在读取 OpenCLI 状态"
          >
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        )
      ) : (
        <>
          {value.browserSupport?.supported === false && (
            <Alert>
              <AlertDescription>{value.browserSupport.issue}</AlertDescription>
            </Alert>
          )}
          {installation?.latestIssue && (
            <Alert>
              <AlertDescription>{installation.latestIssue}</AlertDescription>
            </Alert>
          )}

          <section
            className="flex flex-col gap-3 rounded-xl border bg-card p-4"
            aria-label="Browser Bridge 连接"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusDot tone={value.bridge.connected ? "ok" : "idle"} />
                <h3 className="text-sm font-medium">Browser Bridge</h3>
                <span className="text-xs text-muted-foreground">
                  {value.bridge.connected ? "已连接" : "未连接"}
                </span>
              </div>
              <Button variant="outline" className="text-xs" asChild>
                <a
                  href="https://github.com/jackwener/OpenCLI/releases"
                  target="_blank"
                  rel="noreferrer"
                >
                  官方扩展
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            </div>
            {value.bridge.profileRequired && !config.profile && (
              <Alert>
                <AlertDescription>
                  存在多个浏览器连接，请在下方选择一个设为默认。
                </AlertDescription>
              </Alert>
            )}
            {value.bridge.profiles.length > 0 ? (
              <div className="flex flex-col gap-2">
                {value.bridge.profiles.map((profile) => {
                  const isDefault =
                    config.profile === profile.contextId ||
                    Boolean(
                      config.profile &&
                      profile.aliases?.includes(config.profile)
                    )
                  return (
                    <div
                      key={profile.contextId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-mono font-medium break-all">
                          {profile.contextId}
                        </span>
                        {profile.aliases?.length ? (
                          <Badge variant="outline" className="font-normal">
                            {profile.aliases.join(" / ")}
                          </Badge>
                        ) : null}
                        <span className="text-muted-foreground">
                          v{profile.extensionVersion || "未知"}
                        </span>
                      </div>
                      {isDefault ? (
                        <Badge
                          variant="secondary"
                          className="gap-1 font-normal"
                        >
                          <Check className="size-3" />
                          默认
                        </Badge>
                      ) : (
                        onConfigure && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={configurationDisabled}
                            onClick={() =>
                              onConfigure({ profile: profile.contextId })
                            }
                          >
                            设为默认
                          </Button>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                在 Chrome / Edge 中启用 Browser Bridge 扩展后自动连接。
              </p>
            )}
            {onConfigure && (
              <ManualProfileForm
                key={config.profile}
                currentProfile={config.profile}
                savingConfig={configurationDisabled}
                onSave={(profile) => onConfigure({ profile })}
              />
            )}
          </section>

          <section
            className="flex flex-col gap-3 rounded-xl border bg-card p-4"
            aria-label="OpenCLI 后台"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusDot
                  tone={
                    value.daemon.state === "running"
                      ? "ok"
                      : value.daemon.state === "unknown"
                        ? "error"
                        : "idle"
                  }
                />
                <h3 className="text-sm font-medium">OpenCLI 后台</h3>
                <span className="text-xs text-muted-foreground">
                  {value.daemon.state === "running"
                    ? "运行中"
                    : value.daemon.state === "stopped"
                      ? "已停止"
                      : "占用未确认"}
                </span>
                {value.daemon.pid && (
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    PID {value.daemon.pid} · v{value.daemon.version || "—"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={!!pending || savingConfig}
                  onClick={onRead}
                >
                  <RefreshCw className="size-3.5" />
                  {pending === "status" ? "刷新中…" : "刷新"}
                </Button>
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={
                    disabled ||
                    !installation?.usable ||
                    value.daemon.state === "unknown"
                  }
                  onClick={() => onAction("start")}
                >
                  {value.daemon.state === "running" ? "检查后台" : "启动"}
                </Button>
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={
                    disabled ||
                    !installation?.usable ||
                    value.daemon.state !== "running"
                  }
                  onClick={() => onAction("stop")}
                >
                  停止
                </Button>
              </div>
            </div>
            {!!installation?.version &&
              !!value.daemon.version &&
              installation.version !== value.daemon.version && (
                <Alert>
                  <AlertDescription>
                    后台版本与当前安装不同，请停止后重新启动。
                  </AlertDescription>
                </Alert>
              )}
            {value.issue && (
              <p className="text-xs text-muted-foreground">{value.issue}</p>
            )}
            {onConfigure && (
              <div className="flex items-center justify-between gap-3 border-t pt-3">
                <label
                  htmlFor="opencli-background-mode"
                  className="cursor-pointer text-xs text-muted-foreground select-none"
                >
                  使用上游后台窗口模式
                </label>
                <Switch
                  id="opencli-background-mode"
                  checked={config.background}
                  disabled={configurationDisabled}
                  onCheckedChange={(checked) =>
                    onConfigure({ background: checked })
                  }
                />
              </div>
            )}
          </section>

          <section
            className="flex flex-col gap-3 rounded-xl border bg-card p-4"
            aria-label="官方全局安装"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusDot tone={installed ? "ok" : "idle"} />
                <h3 className="text-sm font-medium">官方全局安装</h3>
                <Badge
                  variant={installed ? "secondary" : "outline"}
                  className="font-mono font-normal"
                >
                  {installation?.version
                    ? `v${installation.version}`
                    : installation?.state === "not-installed"
                      ? "未安装"
                      : "未读取"}
                </Badge>
                {installation?.license && (
                  <span className="text-xs text-muted-foreground">
                    {installation.license}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={
                    disabled ||
                    installed ||
                    installation?.state === "unavailable"
                  }
                  onClick={() => onAction("install")}
                >
                  安装
                </Button>
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={disabled || !installed}
                  onClick={() => onAction("upgrade")}
                >
                  升级
                </Button>
                <Button
                  variant="destructive"
                  className="text-xs"
                  disabled={disabled || !installed}
                  onClick={() => onAction("uninstall")}
                >
                  卸载
                </Button>
              </div>
            </div>
            <div className="grid gap-x-6 gap-y-1.5 border-t pt-3 text-xs sm:grid-cols-[72px_minmax(0,1fr)]">
              <span className="text-muted-foreground">目标版本</span>
              <span className="font-mono">{version || "安装或升级时查询"}</span>
              {installation?.path && (
                <>
                  <span className="text-muted-foreground">安装目录</span>
                  <span className="font-mono break-all">
                    {installation.path}
                  </span>
                </>
              )}
              {installation?.cliPath && (
                <>
                  <span className="text-muted-foreground">程序入口</span>
                  <span className="font-mono break-all">
                    {installation.cliPath}
                  </span>
                </>
              )}
            </div>
          </section>

          {(operation || (pending && pending !== "status")) && (
            <div
              role="status"
              aria-live="polite"
              aria-busy={running}
              className="flex flex-col gap-1.5 rounded-xl border bg-muted/30 p-4 text-xs"
            >
              {operation && (
                <>
                  <div className="flex items-center gap-2 font-medium">
                    <span>{names[operation.action]}</span>
                    <Badge
                      variant={
                        operation.state === "failed"
                          ? "destructive"
                          : operation.state === "succeeded"
                            ? "secondary"
                            : "outline"
                      }
                      className="font-normal"
                    >
                      {operation.state === "running"
                        ? "进行中"
                        : operation.state === "succeeded"
                          ? "已完成"
                          : operation.state === "failed"
                            ? "失败"
                            : "待核对"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{operation.phase}</p>
                  {operation.beforeVersion && (
                    <p className="font-mono text-muted-foreground">
                      {operation.beforeVersion}
                      {operation.targetVersion
                        ? ` → ${operation.targetVersion}`
                        : ""}
                    </p>
                  )}
                  {operation.error && (
                    <p role="alert" className="text-destructive">
                      {operation.error}
                    </p>
                  )}
                </>
              )}
              {pending && pending !== "status" && (
                <p className="text-muted-foreground">
                  正在提交{names[pending]}操作…
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const plugin: PluginWebModule = {
  id,
  apiVersion: 1,
  ownsConfiguration: true,
  pages: [{ id: "browser", component: () => <Page /> }],
}
export default plugin
