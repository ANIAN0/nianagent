import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
    <div className="flex min-w-0 flex-col gap-4 text-sm">
      <p>
        使用官方全局 OpenCLI 和已有 Chrome / Edge 中的 Browser
        Bridge。软件版本、后台运行和浏览器连接分别显示。
      </p>
      <a
        className="w-fit underline underline-offset-4"
        href="https://github.com/jackwener/OpenCLI/releases"
        target="_blank"
        rel="noreferrer"
      >
        官方 Browser Bridge 下载
      </a>
      <section
        className="flex min-w-0 flex-col gap-2"
        aria-label="官方全局安装"
      >
        <p className="font-medium">官方全局安装</p>
        <p>
          当前版本：
          {installation?.version ||
            (installation?.state === "not-installed" ? "未安装" : "未读取")}
          {installation?.license ? ` · ${installation.license}` : ""}
        </p>
        <p>目标版本：{version || "安装或升级时查询官方版本"}</p>
        {installation?.path && (
          <p className="break-all text-muted-foreground">
            安装目录：{installation.path}
          </p>
        )}
        {installation?.cliPath && (
          <p className="break-all text-muted-foreground">
            程序入口：{installation.cliPath}
          </p>
        )}
        {installation?.npmPath && (
          <p className="break-all text-muted-foreground">
            npm：{installation.npmPath}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={
              disabled || installed || installation?.state === "unavailable"
            }
            onClick={() => onAction("install")}
          >
            安装
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !installed}
            onClick={() => onAction("upgrade")}
          >
            升级
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !installed}
            onClick={() => onAction("uninstall")}
          >
            卸载
          </Button>
        </div>
        <p className="text-muted-foreground">
          升级、卸载和停止会影响全局后台及其他 OpenCLI
          使用者。卸载保留用户配置；升级后按实际后台状态启动。
        </p>
      </section>
      <section className="flex flex-col gap-2" aria-label="OpenCLI后台">
        <p className="font-medium">
          后台：
          {value?.daemon.state === "running"
            ? "运行中"
            : value?.daemon.state === "stopped"
              ? "已停止"
              : value?.daemon.state === "unknown"
                ? "占用程序未确认"
                : "未读取"}
        </p>
        {value?.daemon.pid && (
          <p>
            PID {value.daemon.pid} · 实际版本 {value.daemon.version || "未提供"}
          </p>
        )}
        {!!installation?.version &&
          !!value?.daemon.version &&
          installation.version !== value.daemon.version && (
            <Alert>
              <AlertDescription>
                后台版本与当前安装不同，请停止后启动；浏览器工具不会自动替换后台。
              </AlertDescription>
            </Alert>
          )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={
              disabled ||
              !installation?.usable ||
              value?.daemon.state === "unknown"
            }
            onClick={() => onAction("start")}
          >
            {value?.daemon.state === "running" ? "检查已运行后台" : "启动"}
          </Button>
          <Button
            variant="outline"
            disabled={
              disabled ||
              !installation?.usable ||
              value?.daemon.state !== "running"
            }
            onClick={() => onAction("stop")}
          >
            停止
          </Button>
          <Button variant="ghost" disabled={!!pending} onClick={onRead}>
            {pending === "status" ? "读取中…" : "刷新状态"}
          </Button>
        </div>
      </section>
      <section className="flex flex-col gap-2" aria-label="Browser Bridge连接">
        <p className="font-medium">
          Browser Bridge：
          {value ? (value.bridge.connected ? "已连接" : "未连接") : "未读取"}
        </p>
        {value?.bridge.profileRequired && (
          <p>存在多个连接，请在插件配置中选择实际连接 ID 或别名。</p>
        )}
        {value?.bridge.profiles.map((profile) => (
          <p className="break-all" key={profile.contextId}>
            连接 {profile.contextId}
            {profile.aliases?.length
              ? ` · ${profile.aliases.join(" / ")}`
              : ""}{" "}
            · 扩展 {profile.extensionVersion || "版本未提供"}
          </p>
        ))}
        <p className="text-muted-foreground">
          在浏览器启用扩展，连接后选择实际连接。网页在浏览器中，结果和按需截图回到原会话。
        </p>
      </section>
      {operation && (
        <div
          role="status"
          aria-live="polite"
          aria-busy={running}
          className="rounded-lg border p-3"
        >
          <p>
            {names[operation.action]} ·{" "}
            {operation.state === "running"
              ? "进行中"
              : operation.state === "succeeded"
                ? "已完成"
                : operation.state === "failed"
                  ? "失败"
                  : "结果待核对"}
          </p>
          <p>{operation.phase}</p>
          {operation.beforeVersion && (
            <p>
              操作前 {operation.beforeVersion}
              {operation.targetVersion
                ? ` → 目标 ${operation.targetVersion}`
                : ""}
            </p>
          )}
          {operation.error && <p role="alert">{operation.error}</p>}
        </div>
      )}
      {pending && pending !== "status" && (
        <p role="status">正在提交{names[pending]}操作…</p>
      )}
      {value?.issue && <p className="text-muted-foreground">{value.issue}</p>}
      {value?.browserSupport?.supported === false && (
        <Alert>
          <AlertDescription>{value.browserSupport.issue}</AlertDescription>
        </Alert>
      )}
      {installation?.latestIssue && (
        <Alert>
          <AlertDescription>{installation.latestIssue}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert>
          <AlertTitle>读取或提交未确认</AlertTitle>
          <AlertDescription>
            {error}{" "}
            当前显示保留上次读取的状态，请刷新核对；已提交的动作不会自动重做。
          </AlertDescription>
        </Alert>
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
