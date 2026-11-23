import { useEffect, useRef, useState } from "react"
import { ChevronRight, Download, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import type {
  DesktopControlAction,
  DesktopControlService,
  DesktopControlStatus,
  PermissionEntry,
} from "./types"

export const id = "desktop-control"

type DesktopControlConfig = {
  readOnly: boolean
  allowHeaded: boolean
  allowClipboard: boolean
  allowAppLifecycle: boolean
  cursorOverlay: boolean
  recordTrace: boolean
  recordScreenshots: boolean
}

type DesktopControlConfigState = {
  revision: number
  enabled: boolean
  config: DesktopControlConfig
}

const defaultConfig: DesktopControlConfig = {
  readOnly: false,
  allowHeaded: false,
  allowClipboard: false,
  allowAppLifecycle: true,
  cursorOverlay: true,
  recordTrace: true,
  recordScreenshots: false,
}

const normalizeConfig = (raw: unknown): DesktopControlConfig => {
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
    readOnly: Boolean(record.readOnly),
    allowHeaded: Boolean(record.allowHeaded),
    allowClipboard: Boolean(record.allowClipboard),
    allowAppLifecycle:
      record.allowAppLifecycle === undefined
        ? true
        : Boolean(record.allowAppLifecycle),
    cursorOverlay:
      record.cursorOverlay === undefined ? true : Boolean(record.cursorOverlay),
    recordTrace:
      record.recordTrace === undefined ? true : Boolean(record.recordTrace),
    recordScreenshots: Boolean(record.recordScreenshots),
  }
}

const readConfig = async (
  signal?: AbortSignal
): Promise<DesktopControlConfigState> => {
  const plugins = await rpcCall("pluginList", {}, signal)
  const item = plugins.find((entry) => entry.id === id)
  return {
    revision: item?.revision ?? 0,
    enabled: item?.enabled ?? true,
    config: normalizeConfig(item?.configuration),
  }
}

const saveConfig = async (
  patch: Partial<DesktopControlConfig>,
  signal?: AbortSignal
): Promise<DesktopControlConfigState> => {
  const plugins = await rpcCall("pluginList", {}, signal)
  const current = plugins.find((entry) => entry.id === id)
  if (!current) throw new Error("桌面控制插件当前不可用，请刷新后重试。")
  const plugin = await rpcCall(
    "pluginConfigure",
    {
      id,
      revision: current.revision,
      enabled: current.enabled,
      configuration: JSON.stringify({
        ...normalizeConfig(current.configuration),
        ...patch,
      }),
    },
    signal
  )
  pluginsChanged()
  return {
    revision: plugin.revision,
    enabled: plugin.enabled,
    config: normalizeConfig(plugin.configuration),
  }
}

const service: DesktopControlService = {
  read: async (signal) =>
    (
      await callPlugin<{ value: DesktopControlStatus }>(
        id,
        "status",
        {},
        undefined,
        signal
      )
    ).value,
  manage: async (action) =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<DesktopControlService["manage"]>>
      }>(id, action, {})
    ).value,
  probeWindows: async () =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<DesktopControlService["probeWindows"]>>
      }>(id, "probe-windows", {})
    ).value,
  requestPermissions: async () =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<DesktopControlService["requestPermissions"]>>
      }>(id, "request-permissions", {})
    ).value,
  guidePermissions: async () =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<DesktopControlService["guidePermissions"]>>
      }>(id, "guide-permissions", {})
    ).value,
  exportTrace: async (sessionId) =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<DesktopControlService["exportTrace"]>>
      }>(id, "export-trace", sessionId ? { sessionId } : {})
    ).value,
  gcSessions: async () =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<DesktopControlService["gcSessions"]>>
      }>(id, "gc-sessions", {})
    ).value,
}

const actionLabels: Record<DesktopControlAction, string> = {
  install: "安装",
  upgrade: "升级",
  uninstall: "卸载",
}

const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : "桌面控制操作未完成，请刷新后重试。"

const platformName = (platform: string) => {
  if (platform === "win32" || platform === "windows") return "Windows"
  if (platform === "darwin" || platform === "macos") return "macOS"
  if (platform === "linux") return "Linux"
  return platform
}

const permissionLabel = (entry?: PermissionEntry) => {
  if (!entry) return "未知"
  if (entry.state === "granted") return "已授权"
  if (entry.state === "denied") return "未授权"
  if (entry.state === "not_required") return "无需授权"
  return "未请求"
}

const permissionTone = (entry?: PermissionEntry): "ok" | "idle" | "error" => {
  if (!entry) return "idle"
  if (entry.state === "granted" || entry.state === "not_required") return "ok"
  if (entry.state === "denied") return "error"
  return "idle"
}

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

function PolicyRow({
  id: controlId,
  title,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  title: string
  hint?: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label
          htmlFor={controlId}
          className={`cursor-pointer text-sm font-medium select-none ${
            disabled ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {title}
        </label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <Switch
        id={controlId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

export function Page({
  service: source = service,
}: {
  service?: DesktopControlService
}) {
  const [value, setValue] = useState<DesktopControlStatus>()
  const [configState, setConfigState] = useState<DesktopControlConfigState>({
    revision: 0,
    enabled: true,
    config: defaultConfig,
  })
  const [savingConfig, setSavingConfig] = useState(false)
  const [exportedPath, setExportedPath] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState<
    | DesktopControlAction
    | "status"
    | "probe"
    | "permissions"
    | "export"
    | "gc"
    | ""
  >("")
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    let statusRequest = 0
    const syncStatus = () => {
      const request = ++statusRequest
      if (controller.signal.aborted) return
      void source
        .read(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted && request === statusRequest) {
            setValue(result)
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted && request === statusRequest)
            setError(errorText(reason))
        })
    }
    const syncConfig = () => {
      if (controller.signal.aborted) return
      void readConfig(controller.signal)
        .then((cfg) => {
          if (!controller.signal.aborted) setConfigState(cfg)
        })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(errorText(reason))
        })
    }

    syncStatus()
    syncConfig()

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
    if (!running) return
    const controller = new AbortController()
    const poll = async () => {
      try {
        const status = await source.read(controller.signal)
        if (!controller.signal.aborted) setValue(status)
      } catch (reason) {
        if (!controller.signal.aborted) setError(errorText(reason))
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 1500)
    }
    let timer = window.setTimeout(poll, 1500)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [running, source])

  const refresh = async () => {
    setError("")
    setPending("status")
    try {
      const [result, cfg] = await Promise.all([source.read(), readConfig()])
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

  const updateConfig = async (patch: Partial<DesktopControlConfig>) => {
    if (savingConfig || running) return
    setSavingConfig(true)
    setError("")
    try {
      const saved = await saveConfig(patch)
      if (mounted.current) {
        setConfigState(saved)
        notifyToast("配置已保存", { tone: "success" })
      }
    } catch (reason) {
      if (mounted.current) setError(errorText(reason))
    } finally {
      if (mounted.current) setSavingConfig(false)
    }
  }

  const manage = async (action: DesktopControlAction) => {
    if (pending || value?.operation?.state === "running") return
    setPending(action)
    setError("")
    try {
      const res = await source.manage(action)
      if (!mounted.current) return
      setValue((prev) =>
        prev &&
        (prev.operation?.id !== res.operation.id ||
          prev.operation.state === "running")
          ? { ...prev, operation: res.operation }
          : prev
      )
    } catch (reason) {
      if (mounted.current) setError(errorText(reason))
    } finally {
      if (mounted.current) setPending("")
    }
  }

  const probeWindows = async () => {
    if (pending) return
    setPending("probe")
    setError("")
    try {
      const res = await source.probeWindows()
      if (!mounted.current) return
      if (res.ok) {
        notifyToast(
          `已连通无障碍树：${res.windowCount} 个窗口 · ${res.appCount} 个应用`,
          { tone: "success" }
        )
      } else {
        setError(res.issue || "未能读取桌面窗口。")
      }
    } catch (reason) {
      if (mounted.current) setError(errorText(reason))
    } finally {
      if (mounted.current) setPending("")
    }
  }

  const runPermissionAction = async (kind: "request" | "guide") => {
    if (pending) return
    setPending("permissions")
    setError("")
    try {
      if (kind === "request") {
        await source.requestPermissions()
        notifyToast("已刷新系统权限状态", { tone: "success" })
      } else {
        await source.guidePermissions()
        notifyToast("已打开系统权限设置引导", { tone: "success" })
      }
      const next = await source.read()
      if (mounted.current) setValue(next)
    } catch (reason) {
      if (mounted.current) setError(errorText(reason))
    } finally {
      if (mounted.current) setPending("")
    }
  }

  const handleExportTrace = async () => {
    if (pending) return
    setPending("export")
    setError("")
    try {
      const res = await source.exportTrace()
      if (mounted.current) {
        setExportedPath(res.path)
        notifyToast("已导出追踪报告", { tone: "success" })
      }
    } catch (reason) {
      if (mounted.current) setError(errorText(reason))
    } finally {
      if (mounted.current) setPending("")
    }
  }

  const handleGcSessions = async () => {
    if (pending) return
    setPending("gc")
    setError("")
    try {
      const res = await source.gcSessions()
      const next = await source.read()
      if (mounted.current) {
        setValue(next)
        notifyToast(`已清理 ${res.removedCount} 个已结束会话`, {
          tone: "success",
        })
      }
    } catch (reason) {
      if (mounted.current) setError(errorText(reason))
    } finally {
      if (mounted.current) setPending("")
    }
  }

  const installation = value?.installation
  const busy = !!pending || running || !value
  const installed = installation?.state === "installed"
  const usable = Boolean(installation?.usable)
  const operation = value?.operation
  const env = value?.environment
  const isMac = env?.platform === "darwin" || env?.platform === "macos"
  const macMissingPerm =
    isMac &&
    Boolean(
      env?.permissions &&
      (env.permissions.accessibility.state === "denied" ||
        env.permissions.accessibility.state === "unknown" ||
        env.permissions.screen_recording.state === "denied")
    )

  const statusTone: "ok" | "idle" | "error" = !usable
    ? installation?.state !== "not-installed"
      ? "error"
      : "idle"
    : env?.ok
      ? "ok"
      : "error"

  const statusLabel = !usable
    ? installed
      ? "CLI 不可用"
      : installation?.state === "unavailable"
        ? "环境不可用"
        : "未安装 CLI"
    : env?.ok
      ? "已就绪"
      : macMissingPerm
        ? "缺少系统权限"
        : "环境异常"

  const statusMeta = [
    installation?.version ? `v${installation.version}` : "",
    env?.platform ? platformName(env.platform) : "",
    configState.config.readOnly ? "只读" : "",
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-label="桌面控制配置">
      {error && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!value && error ? (
        <Button
          variant="outline"
          className="w-fit"
          disabled={!!pending}
          onClick={() => void refresh()}
        >
          {pending === "status" ? "重试中…" : "重试"}
        </Button>
      ) : !value ? (
        <div className="flex flex-col gap-4" aria-label="正在读取桌面控制状态">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-4 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusDot tone={statusTone} />
                <span className="text-sm font-medium">{statusLabel}</span>
                {statusMeta && (
                  <span className="text-xs text-muted-foreground">
                    {statusMeta}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={!!pending}
                  onClick={() => void refresh()}
                >
                  <RefreshCw className="size-3.5" />
                  {pending === "status" ? "刷新中…" : "刷新"}
                </Button>
                {!installed ? (
                  <Button
                    className="h-8 text-xs"
                    disabled={busy || installation?.state === "unavailable"}
                    onClick={() => void manage("install")}
                  >
                    <Download className="size-3.5" />
                    安装 CLI
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={busy || !usable}
                      onClick={() => void probeWindows()}
                    >
                      {pending === "probe" ? "检测中…" : "检测窗口"}
                    </Button>
                    {macMissingPerm && (
                      <>
                        <Button
                          className="h-8 text-xs"
                          disabled={busy}
                          onClick={() => void runPermissionAction("request")}
                        >
                          请求权限
                        </Button>
                        <Button
                          variant="outline"
                          className="h-8 text-xs"
                          disabled={busy}
                          onClick={() => void runPermissionAction("guide")}
                        >
                          系统引导
                        </Button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {usable && env?.permissions && isMac && (
              <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <StatusDot
                    tone={permissionTone(env.permissions.accessibility)}
                  />
                  <span className="text-muted-foreground">辅助功能</span>
                  <span>{permissionLabel(env.permissions.accessibility)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusDot
                    tone={permissionTone(env.permissions.screen_recording)}
                  />
                  <span className="text-muted-foreground">屏幕录制</span>
                  <span>
                    {permissionLabel(env.permissions.screen_recording)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusDot
                    tone={permissionTone(env.permissions.automation)}
                  />
                  <span className="text-muted-foreground">自动化</span>
                  <span>{permissionLabel(env.permissions.automation)}</span>
                </div>
              </div>
            )}

            {env?.supportedSurfaces.length ? (
              <p className="text-xs wrap-anywhere text-muted-foreground">
                可用表面 {env.supportedSurfaces.join(" / ")}
              </p>
            ) : null}

            {usable && env?.issue && (
              <Alert>
                <AlertDescription>{env.issue}</AlertDescription>
              </Alert>
            )}

            {!usable && installation?.issue && (
              <Alert>
                <AlertDescription>{installation.issue}</AlertDescription>
              </Alert>
            )}

            {installation?.launcherFallback && (
              <Alert>
                <AlertDescription>
                  正在使用 npm 包内的原生程序。通过 npm
                  重新安装或升级可恢复官方命令入口。
                </AlertDescription>
              </Alert>
            )}

            <div className="divide-y border-t pt-4">
              <PolicyRow
                id="desktop-read-only"
                title="只读模式"
                hint="仅观察界面，禁止点击、输入与窗口控制"
                checked={configState.config.readOnly}
                disabled={savingConfig || running}
                onCheckedChange={(readOnly) => void updateConfig({ readOnly })}
              />
              <PolicyRow
                id="desktop-allow-headed"
                title="物理键鼠输入"
                hint="允许物理按键、移动指针与切换前景焦点"
                checked={configState.config.allowHeaded}
                disabled={savingConfig || running}
                onCheckedChange={(allowHeaded) =>
                  void updateConfig({ allowHeaded })
                }
              />
              <PolicyRow
                id="desktop-allow-clipboard"
                title="剪贴板访问"
                hint="允许工具直接读取、写入与清空系统剪贴板"
                checked={configState.config.allowClipboard}
                disabled={savingConfig || running}
                onCheckedChange={(allowClipboard) =>
                  void updateConfig({ allowClipboard })
                }
              />
              <PolicyRow
                id="desktop-allow-app-lifecycle"
                title="应用启停"
                hint="允许启动或关闭桌面应用（禁止强杀）"
                checked={configState.config.allowAppLifecycle}
                disabled={savingConfig || running}
                onCheckedChange={(allowAppLifecycle) =>
                  void updateConfig({ allowAppLifecycle })
                }
              />
            </div>
          </section>

          {(operation ||
            (pending &&
              (pending === "install" ||
                pending === "upgrade" ||
                pending === "uninstall"))) && (
            <div
              role="status"
              aria-live="polite"
              aria-busy={running}
              className="flex flex-col gap-1.5 rounded-xl border bg-muted/30 p-4 text-xs"
            >
              {operation && (
                <>
                  <div className="flex items-center gap-2 font-medium">
                    <span>{actionLabels[operation.action]}</span>
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
            </div>
          )}

          <details className="group rounded-xl border bg-card px-4 py-3 text-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-foreground select-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                <span>高级与维护</span>
              </span>
              <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">
                会话 {value.sessions.activeCount + value.sessions.endedCount}
              </span>
            </summary>

            <div className="mt-3 flex flex-col gap-4 border-t pt-3">
              <div className="divide-y">
                <PolicyRow
                  id="desktop-cursor-overlay"
                  title="操作光标提示"
                  hint="headless 操作时在目标控件绘制指示光标"
                  checked={configState.config.cursorOverlay}
                  disabled={savingConfig || running}
                  onCheckedChange={(cursorOverlay) =>
                    void updateConfig({ cursorOverlay })
                  }
                />
                <PolicyRow
                  id="desktop-record-trace"
                  title="操作追踪"
                  hint="记录自动脱敏的事件时间线"
                  checked={configState.config.recordTrace}
                  disabled={savingConfig || running}
                  onCheckedChange={(recordTrace) =>
                    void updateConfig({
                      recordTrace,
                      ...(recordTrace ? {} : { recordScreenshots: false }),
                    })
                  }
                />
                {configState.config.recordTrace && (
                  <PolicyRow
                    id="desktop-record-screenshots"
                    title="追踪附带截图"
                    hint="保存操作前后未脱敏 PNG 画面"
                    checked={configState.config.recordScreenshots}
                    disabled={savingConfig || running}
                    onCheckedChange={(recordScreenshots) =>
                      void updateConfig({ recordScreenshots })
                    }
                  />
                )}
              </div>

              {installation?.latestIssue && (
                <Alert>
                  <AlertDescription>
                    {installation.latestIssue}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-x-4 gap-y-3 border-t pt-3 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-center">
                {installation?.latestVersion && (
                  <>
                    <span className="text-xs font-medium text-muted-foreground">
                      官方版本
                    </span>
                    <span className="font-mono text-xs">
                      v{installation.latestVersion}
                    </span>
                  </>
                )}
                <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
                  托管会话
                </span>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    活跃 {value.sessions.activeCount} · 已结束{" "}
                    {value.sessions.endedCount}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={
                        busy || !usable || !value.sessions.latestTraceAvailable
                      }
                      onClick={() => void handleExportTrace()}
                    >
                      {pending === "export" ? "导出中…" : "导出追踪"}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={
                        busy || !usable || value.sessions.endedCount === 0
                      }
                      onClick={() => void handleGcSessions()}
                    >
                      {pending === "gc" ? "清理中…" : "清理旧会话"}
                    </Button>
                  </div>
                </div>

                {exportedPath && (
                  <>
                    <span className="text-xs font-medium text-muted-foreground">
                      导出报告
                    </span>
                    <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs break-all select-all">
                      {exportedPath}
                    </div>
                  </>
                )}

                {installation?.path && (
                  <>
                    <span className="text-xs font-medium text-muted-foreground">
                      安装目录
                    </span>
                    <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs break-all select-all">
                      {installation.path}
                    </div>
                  </>
                )}

                {installation?.cliPath && (
                  <>
                    <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
                      程序入口
                    </span>
                    <div
                      title={installation.cliPath}
                      className="min-w-0 rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs break-all text-foreground"
                    >
                      <span className="select-all">{installation.cliPath}</span>
                    </div>
                  </>
                )}

                {env?.stateRoot && (
                  <>
                    <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
                      数据目录
                    </span>
                    <div
                      title={env.stateRoot}
                      className="min-w-0 rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs break-all text-foreground"
                    >
                      <span className="select-all">{env.stateRoot}</span>
                    </div>
                  </>
                )}

                {installed && installation?.source === "npm" && (
                  <>
                    <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
                      CLI 维护
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        className="h-8 text-xs"
                        disabled={busy}
                        onClick={() => void manage("upgrade")}
                      >
                        升级
                      </Button>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="destructive"
                            className="h-8 text-xs"
                            disabled={busy}
                          >
                            卸载
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>卸载全局 agent-desktop</DialogTitle>
                            <DialogDescription>
                              此操作会影响使用这份全局安装的其他程序。
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline">取消</Button>
                            </DialogClose>
                            <DialogClose asChild>
                              <Button
                                variant="destructive"
                                onClick={() => void manage("uninstall")}
                              >
                                确认卸载
                              </Button>
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </>
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
  pages: [{ id: "desktop", component: () => <Page /> }],
}
export default plugin
