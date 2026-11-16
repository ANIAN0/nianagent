import { useEffect, useRef, useState } from "react"
import { ExternalLink, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { callPlugin } from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import type { OpenCliAction, OpenCliService, OpenCliStatus } from "./types"
export type { OpenCliStatus } from "./types"
export const id = "opencli"
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
  error instanceof Error ? error.message : "OpenCLI操作未确认，请重新读取。"

export function Page({
  service: source = service,
}: {
  service?: OpenCliService
}) {
  const [value, setValue] = useState<OpenCliStatus>()
  const [error, setError] = useState("")
  const [pending, setPending] = useState<OpenCliAction | "status" | "">("")
  const mounted = useRef(false)
  const accepting = useRef(false)
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void source
      .read(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setValue(result)
          setError("")
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error))
      })
    return () => {
      mounted.current = false
      controller.abort()
    }
  }, [source])
  const running = value?.operation?.state === "running"
  useEffect(() => {
    if (!running) return
    const controller = new AbortController()
    let reading = false
    const timer = setInterval(() => {
      if (reading) return
      reading = true
      void source
        .read(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setValue(result)
            setError("")
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(errorText(error))
        })
        .finally(() => {
          reading = false
        })
    }, 1000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [source, running])
  const read = async () => {
    setPending("status")
    try {
      const result = await source.read()
      if (mounted.current) {
        setValue(result)
        setError("")
      }
    } catch (error) {
      if (mounted.current) setError(errorText(error))
    } finally {
      if (mounted.current) setPending("")
    }
  }
  const manage = async (action: OpenCliAction) => {
    if (accepting.current || running || !value) return
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
    } catch (error) {
      if (mounted.current) setError(errorText(error))
    } finally {
      accepting.current = false
      if (mounted.current) setPending("")
    }
  }
  return (
    <OpenCliConnectionView
      value={value}
      error={error}
      pending={pending}
      onRead={() => void read()}
      onAction={(action) => void manage(action)}
    />
  )
}

export function OpenCliConnectionView({
  value,
  error,
  pending = "",
  onRead,
  onAction,
}: {
  value?: OpenCliStatus
  error: string
  pending?: OpenCliAction | "status" | ""
  onRead: () => void
  onAction: (action: OpenCliAction) => void
}) {
  const installation = value?.installation
  const running = value?.operation?.state === "running"
  const disabled = !!pending || running || !value
  const installed = installation?.state === "installed"
  const operation = value?.operation
  const version = operation?.targetVersion || installation?.latestVersion
  return (
    <div className="flex min-w-0 flex-col gap-5 text-sm">
      {error && (
        <Alert>
          <AlertTitle>读取或提交未确认</AlertTitle>
          <AlertDescription>
            {error}{" "}
            当前显示保留上次读取的状态，请刷新核对；已提交的动作不会自动重做。
          </AlertDescription>
        </Alert>
      )}
      {!value ? (
        <div className="flex flex-col gap-4" aria-label="正在读取 OpenCLI 状态">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
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
            className="flex flex-col gap-3 rounded-xl border bg-card p-5"
            aria-label="Browser Bridge连接"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="font-semibold">Browser Bridge 连接</h3>
                <Badge
                  variant={value.bridge.connected ? "secondary" : "outline"}
                >
                  {value.bridge.connected ? "已连接" : "未连接"}
                </Badge>
              </div>
              <a
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                href="https://github.com/jackwener/OpenCLI/releases"
                target="_blank"
                rel="noreferrer"
              >
                下载官方扩展
                <ExternalLink className="size-3" />
              </a>
            </div>
            {value.bridge.profileRequired && (
              <Alert>
                <AlertDescription>
                  存在多个浏览器连接，请在下方“插件配置”中选择实际连接 ID
                  或别名。
                </AlertDescription>
              </Alert>
            )}
            {value.bridge.profiles.length > 0 ? (
              <div className="flex flex-col gap-2">
                {value.bridge.profiles.map((profile) => (
                  <div
                    key={profile.contextId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-medium">
                        {profile.contextId}
                      </span>
                      {profile.aliases?.length ? (
                        <Badge variant="outline">
                          {profile.aliases.join(" / ")}
                        </Badge>
                      ) : null}
                    </div>
                    <span className="text-muted-foreground">
                      扩展 {profile.extensionVersion || "版本未提供"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                在 Chrome / Edge 中启用 Browser Bridge
                扩展后即可自动连接；网页在浏览器中运行，结果和截图回到原会话。
              </p>
            )}
          </section>

          <section
            className="flex flex-col gap-3 rounded-xl border bg-card p-5"
            aria-label="OpenCLI后台"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="font-semibold">OpenCLI 后台</h3>
                <Badge
                  variant={
                    value.daemon.state === "running" ? "secondary" : "outline"
                  }
                >
                  {value.daemon.state === "running"
                    ? "运行中"
                    : value.daemon.state === "stopped"
                      ? "已停止"
                      : "占用程序未确认"}
                </Badge>
                {value.daemon.pid && (
                  <span className="font-mono text-xs text-muted-foreground">
                    PID {value.daemon.pid} · v{value.daemon.version || "未提供"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!pending}
                  onClick={onRead}
                >
                  <RefreshCw className="size-3.5" />
                  {pending === "status" ? "读取中…" : "刷新状态"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
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
                  size="sm"
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
                    后台版本与当前安装不同，请停止后重新启动；浏览器工具不会自动替换后台。
                  </AlertDescription>
                </Alert>
              )}
            {value.issue && (
              <p className="text-xs text-muted-foreground">{value.issue}</p>
            )}
          </section>

          <section
            className="flex flex-col gap-3 rounded-xl border bg-card p-5"
            aria-label="官方全局安装"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="font-semibold">官方全局安装</h3>
                <Badge variant={installed ? "secondary" : "outline"}>
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
                  size="sm"
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
                  size="sm"
                  disabled={disabled || !installed}
                  onClick={() => onAction("upgrade")}
                >
                  升级
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={disabled || !installed}
                  onClick={() => onAction("uninstall")}
                >
                  卸载
                </Button>
              </div>
            </div>
            <div className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-[72px_minmax(0,1fr)]">
              <span className="text-muted-foreground">目标版本</span>
              <span>{version || "安装或升级时查询官方版本"}</span>
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
            <p className="text-xs text-muted-foreground">
              升级、卸载和停止会影响全局后台及其他 OpenCLI
              使用者；卸载保留用户配置。
            </p>
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
                    <Badge variant="outline">
                      {operation.state === "running"
                        ? "进行中"
                        : operation.state === "succeeded"
                          ? "已完成"
                          : operation.state === "failed"
                            ? "失败"
                            : "结果待核对"}
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
  pages: [{ id: "browser", component: () => <Page /> }],
}
export default plugin
