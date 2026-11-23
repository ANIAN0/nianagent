import { useEffect, useRef, useState } from "react"
import {
  Copy,
  Download,
  MonitorPlay,
  RefreshCw,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { notifyToast } from "@/components/ui/notification-toast"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import {
  callPlugin,
  pluginsChanged,
  subscribePluginEvent,
} from "@/features/plugins/plugin-service"
import { rpcCall } from "@/lib/rpc/client"
import type {
  AndroidControlAction,
  AndroidControlOperation,
  AndroidControlService,
  AndroidControlStatus,
  AndroidDevice,
} from "./types"

export const id = "android-control"

type AndroidControlConfig = {
  scrcpyPath: string
  defaultSerial: string
  readOnly: boolean
  allowClipboard: boolean
  allowAppLifecycle: boolean
  allowApkInstall: boolean
  allowFileTransfer: boolean
  mirrorMaxSize: number
  mirrorScreenOff: boolean
  mirrorStayAwake: boolean
  mirrorReadOnly: boolean
}

type AndroidControlConfigState = {
  revision: number
  enabled: boolean
  config: AndroidControlConfig
}

const defaultConfig: AndroidControlConfig = {
  scrcpyPath: "",
  defaultSerial: "",
  readOnly: false,
  allowClipboard: false,
  allowAppLifecycle: true,
  allowApkInstall: false,
  allowFileTransfer: false,
  mirrorMaxSize: 1080,
  mirrorScreenOff: false,
  mirrorStayAwake: true,
  mirrorReadOnly: false,
}

const normalizeConfig = (raw: unknown): AndroidControlConfig => {
  let parsed = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return defaultConfig
    }
  }
  if (!parsed || typeof parsed !== "object") return defaultConfig
  const r = parsed as Record<string, unknown>
  const maxSize = Number(r.mirrorMaxSize)
  return {
    scrcpyPath: typeof r.scrcpyPath === "string" ? r.scrcpyPath.trim() : "",
    defaultSerial:
      typeof r.defaultSerial === "string" ? r.defaultSerial.trim() : "",
    readOnly: Boolean(r.readOnly),
    allowClipboard: Boolean(r.allowClipboard),
    allowAppLifecycle:
      r.allowAppLifecycle === undefined ? true : Boolean(r.allowAppLifecycle),
    allowApkInstall: Boolean(r.allowApkInstall),
    allowFileTransfer: Boolean(r.allowFileTransfer),
    mirrorMaxSize: Number.isFinite(maxSize) && maxSize >= 0 ? maxSize : 1080,
    mirrorScreenOff: Boolean(r.mirrorScreenOff),
    mirrorStayAwake:
      r.mirrorStayAwake === undefined ? true : Boolean(r.mirrorStayAwake),
    mirrorReadOnly: Boolean(r.mirrorReadOnly),
  }
}

const readConfig = async (
  signal?: AbortSignal
): Promise<AndroidControlConfigState> => {
  const plugins = await rpcCall("pluginList", {}, signal)
  const item = plugins.find((entry) => entry.id === id)
  return {
    revision: item?.revision ?? 0,
    enabled: item?.enabled ?? true,
    config: normalizeConfig(item?.configuration),
  }
}

const saveConfig = async (
  next: AndroidControlConfig,
  signal?: AbortSignal
): Promise<AndroidControlConfigState> => {
  const plugins = await rpcCall("pluginList", {}, signal)
  const current = plugins.find((entry) => entry.id === id)
  if (!current) throw new Error("安卓控制插件当前不可用，请刷新后重试。")
  const plugin = await rpcCall(
    "pluginConfigure",
    {
      id,
      revision: current.revision,
      enabled: current.enabled,
      configuration: JSON.stringify(next),
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

const service: AndroidControlService = {
  read: async (signal) =>
    (
      await callPlugin<{ value: AndroidControlStatus }>(
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
        value: Awaited<ReturnType<AndroidControlService["manage"]>>
      }>(id, action, {})
    ).value,
  cancelManage: async () =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<AndroidControlService["cancelManage"]>>
      }>(id, "cancel-manage", {})
    ).value,
  refreshDevices: async () =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<AndroidControlService["refreshDevices"]>>
      }>(id, "refresh-devices", {})
    ).value,
  connectWireless: async (address) =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<AndroidControlService["connectWireless"]>>
      }>(id, "connect-wireless", { address })
    ).value,
  pairWireless: async (address, pairingCode) =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<AndroidControlService["pairWireless"]>>
      }>(id, "pair-wireless", { address, pairingCode })
    ).value,
  enableTcpip: async (serial, port) =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<AndroidControlService["enableTcpip"]>>
      }>(id, "enable-tcpip", port ? { serial, port } : { serial })
    ).value,
  disconnectWireless: async (serial) =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<AndroidControlService["disconnectWireless"]>>
      }>(id, "disconnect-wireless", { serial })
    ).value,
  startMirror: async (input) =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<AndroidControlService["startMirror"]>>
      }>(id, "start-mirror", input || {})
    ).value,
  stopMirror: async (serial) =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<AndroidControlService["stopMirror"]>>
      }>(id, "stop-mirror", { serial })
    ).value,
  probeDevice: async (serial) =>
    (
      await callPlugin<{
        value: Awaited<ReturnType<AndroidControlService["probeDevice"]>>
      }>(id, "probe-device", serial ? { serial } : {})
    ).value,
}

const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : "安卓控制操作未完成，请刷新后重试。"

const manualInstallCommand = (
  pm: AndroidControlStatus["installation"]["packageManager"]
): string | null => {
  if (pm === "winget") {
    return '& "$env:LOCALAPPDATA\\Microsoft\\WindowsApps\\winget.exe" install --exact Genymobile.scrcpy --accept-source-agreements --accept-package-agreements'
  }
  if (pm === "scoop") return "scoop install scrcpy adb"
  if (pm === "choco") return "choco install scrcpy adb -y"
  if (pm === "brew") return "brew install scrcpy"
  return null
}

const sourceLabel = (source: AndroidControlStatus["installation"]["source"]) => {
  if (source === "custom") return "自定义路径"
  if (source === "path") return "系统 PATH"
  if (source === "package-manager") return "系统包管理器目录"
  return "未发现"
}

function StatusDot({ tone }: { tone: "ok" | "idle" | "warn" | "error" }) {
  return (
    <span
      aria-hidden="true"
      className={
        tone === "ok"
          ? "size-2 shrink-0 rounded-full bg-emerald-500"
          : tone === "warn"
            ? "size-2 shrink-0 rounded-full bg-amber-500"
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
        {hint && (
          <span className="text-xs text-muted-foreground">{hint}</span>
        )}
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

const maxSizeOptions = [
  { label: "720p", value: 720 },
  { label: "1080p", value: 1080 },
  { label: "1440p", value: 1440 },
  { label: "原始", value: 0 },
]

export function Page({
  service: source = service,
}: {
  service?: AndroidControlService
}) {
  const [value, setValue] = useState<AndroidControlStatus>()
  const [configState, setConfigState] = useState<AndroidControlConfigState>({
    revision: 0,
    enabled: true,
    config: defaultConfig,
  })
  const [customPathDraft, setCustomPathDraft] = useState("")
  const [wirelessOpen, setWirelessOpen] = useState(false)
  const [connectAddress, setConnectAddress] = useState("")
  const [pairAddress, setPairAddress] = useState("")
  const [pairCode, setPairCode] = useState("")
  const [savingConfig, setSavingConfig] = useState(false)
  const [pending, setPending] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      source.read(controller.signal),
      readConfig(controller.signal).catch(() => ({
        revision: 0,
        enabled: true,
        config: defaultConfig,
      })),
    ])
      .then(([statusRes, cfgRes]) => {
        if (!controller.signal.aborted) {
          setValue(statusRes)
          setConfigState(cfgRes)
          setCustomPathDraft(cfgRes.config.scrcpyPath)
          setError("")
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorText(reason))
      })

    const refreshStatus = () => {
      if (controller.signal.aborted) return
      void source
        .read(controller.signal)
        .then((res) => {
          if (!controller.signal.aborted) {
            setValue(res)
            setError("")
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(errorText(reason))
        })
    }

    const offStatus = subscribePluginEvent(id, "status-changed", refreshStatus)
    const offDevices = subscribePluginEvent(id, "devices-changed", refreshStatus)
    const offMirror = subscribePluginEvent(id, "mirror-changed", refreshStatus)
    const offOperation = subscribePluginEvent(
      id,
      "operation-changed",
      (payload) => {
        if (controller.signal.aborted) return
        const nextOp =
          payload &&
          typeof payload === "object" &&
          "operation" in payload
            ? ((payload as { operation?: AndroidControlOperation | null })
                .operation ?? null)
            : null
        if (!nextOp) return
        setValue((prev) => (prev ? { ...prev, operation: nextOp } : prev))
      }
    )
    const onPluginsChanged = () => {
      void readConfig(controller.signal)
        .then((cfg) => {
          if (!controller.signal.aborted) {
            setConfigState(cfg)
            setCustomPathDraft(cfg.config.scrcpyPath)
          }
        })
        .catch(() => {})
    }
    window.addEventListener("moon:plugins-changed", onPluginsChanged)

    return () => {
      controller.abort()
      offStatus()
      offDevices()
      offMirror()
      offOperation()
      window.removeEventListener("moon:plugins-changed", onPluginsChanged)
    }
  }, [source])

  const logBoxRef = useRef<HTMLPreElement | null>(null)
  const isOperationRunning = value?.operation?.state === "running"
  const operationLogCount = value?.operation?.logs?.length ?? 0

  useEffect(() => {
    if (!isOperationRunning) return
    const controller = new AbortController()
    const timer = window.setInterval(() => {
      void source
        .read(controller.signal)
        .then((res) => {
          if (!controller.signal.aborted) setValue(res)
        })
        .catch(() => {})
    }, 1000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [isOperationRunning, source])

  useEffect(() => {
    const el = logBoxRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [operationLogCount])

  const updateConfig = async (
    patch: Partial<AndroidControlConfig>,
    toastMessage?: string
  ) => {
    const next = { ...configState.config, ...patch }
    const prev = configState
    setConfigState({ ...prev, config: next })
    setSavingConfig(true)
    setError("")
    try {
      const saved = await saveConfig(next)
      setConfigState(saved)
      setCustomPathDraft(saved.config.scrcpyPath)
      const latest = await source.read()
      setValue(latest)
      if (toastMessage) {
        notifyToast(toastMessage, { tone: "success" })
      }
    } catch (reason) {
      setConfigState(prev)
      setError(errorText(reason))
    } finally {
      setSavingConfig(false)
    }
  }

  const runAction = async (
    key: string,
    fn: () => Promise<void>
  ) => {
    setPending(key)
    setError("")
    try {
      await fn()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setPending("")
    }
  }

  const runManage = async (action: AndroidControlAction) => {
    await runAction(action, async () => {
      await source.manage(action)
      const latest = await source.read()
      setValue(latest)
    })
  }

  const runCancelManage = async () => {
    await runAction("cancel-manage", async () => {
      const res = await source.cancelManage()
      if (res.operation) {
        setValue((prev) =>
          prev ? { ...prev, operation: res.operation } : prev
        )
      }
    })
  }

  if (!value && !error) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    )
  }

  const installation = value?.installation
  const devices = value?.devices ?? []
  const operation = value?.operation
  const runningJob = operation?.state === "running"
  const busy = Boolean(pending) || runningJob || savingConfig
  const cfg = configState.config
  const onlineDevices = devices.filter((d) => d.state === "device")

  const deviceSummaryTone: "ok" | "idle" | "warn" | "error" =
    !installation?.usable
      ? "idle"
      : onlineDevices.length > 0
        ? "ok"
        : devices.some((d) => d.state === "unauthorized")
          ? "warn"
          : "idle"

  const deviceSummaryText = !installation?.usable
    ? "未检测到可用 ADB"
    : onlineDevices.length > 0
      ? `已连接 ${onlineDevices.length} 台设备`
      : devices.length > 0
        ? `${devices.length} 台设备待授权或离线`
        : "未检测到设备"

  const envTone: "ok" | "idle" | "warn" | "error" =
    installation?.state === "ready"
      ? "ok"
      : installation?.state === "partial"
        ? "warn"
        : installation?.state === "unavailable"
          ? "error"
          : "idle"

  const envSummary =
    installation?.state === "ready"
      ? `scrcpy ${installation.scrcpyVersion || ""} · adb ${installation.adbVersion || ""}`.trim()
      : installation?.state === "partial"
        ? "部分依赖可用"
        : installation?.state === "unavailable"
          ? "环境异常"
          : "未安装 scrcpy / ADB"

  const deviceIssue =
    devices.find((d) => d.issue)?.issue || installation?.issue || ""

  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm">
      {(error || deviceIssue) && (
        <Alert>
          <AlertTitle>{error ? "操作未完成" : "设备连接提示"}</AlertTitle>
          <AlertDescription className="break-words">
            {error || deviceIssue}
          </AlertDescription>
        </Alert>
      )}

      {/* Card 1 · 设备与连接 */}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot tone={deviceSummaryTone} />
            <span className="font-medium text-foreground truncate">
              {deviceSummaryText}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={wirelessOpen ? "secondary" : "outline"}
              size="sm"
              className="h-8"
              disabled={!installation?.usable || busy}
              onClick={() => setWirelessOpen((v) => !v)}
            >
              <Wifi className="size-3.5" />
              无线连接
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={busy}
              onClick={() =>
                void runAction("refresh", async () => {
                  await source.refreshDevices()
                  const latest = await source.read()
                  setValue(latest)
                })
              }
            >
              <RefreshCw
                className={`size-3.5 ${pending === "refresh" ? "animate-spin" : ""}`}
              />
              刷新
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={!installation?.usable || onlineDevices.length === 0 || busy}
              onClick={() =>
                void runAction("probe", async () => {
                  const res = await source.probeDevice()
                  notifyToast(
                    `已连通 ${res.model}（${res.resolution}），识别 ${res.uiNodeCount} 个控件`,
                    { tone: "success" }
                  )
                })
              }
            >
              截屏测试
            </Button>
          </div>
        </div>

        {wirelessOpen && (
          <div className="flex flex-col gap-2.5 py-3 border-b">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={connectAddress}
                onChange={(e) => setConnectAddress(e.target.value)}
                placeholder="连接地址，例如 192.168.1.23:5555"
                className="h-8 min-w-[200px] flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={busy || !connectAddress.trim()}
                onClick={() =>
                  void runAction("connect-wireless", async () => {
                    const res = await source.connectWireless(connectAddress.trim())
                    setConnectAddress("")
                    const latest = await source.read()
                    setValue(latest)
                    notifyToast(`已连接 ${res.serial}`, { tone: "success" })
                  })
                }
              >
                连接
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={pairAddress}
                onChange={(e) => setPairAddress(e.target.value)}
                placeholder="配对地址 IP:端口"
                className="h-8 min-w-[160px] flex-1 font-mono text-xs"
              />
              <Input
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value)}
                placeholder="6 位配对码"
                className="h-8 w-28 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={busy || !pairAddress.trim() || !pairCode.trim()}
                onClick={() =>
                  void runAction("pair-wireless", async () => {
                    await source.pairWireless(pairAddress.trim(), pairCode.trim())
                    setPairAddress("")
                    setPairCode("")
                    notifyToast("无线调试配对成功，请点击连接", {
                      tone: "success",
                    })
                  })
                }
              >
                配对
              </Button>
            </div>
          </div>
        )}

        <div className="divide-y">
          {devices.length === 0 ? (
            <div className="py-5 text-center text-xs text-muted-foreground">
              {installation?.usable
                ? "请开启手机「USB 调试」后连接数据线，或点击上方「无线连接」。"
                : "请先完成下方 scrcpy 与 ADB 运行环境配置。"}
            </div>
          ) : (
            devices.map((device: AndroidDevice) => {
              const online = device.state === "device"
              const tone: "ok" | "warn" | "error" | "idle" = online
                ? "ok"
                : device.state === "unauthorized"
                  ? "warn"
                  : "error"
              return (
                <div
                  key={device.serial}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 last:pb-0"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusDot tone={tone} />
                      <span className="font-medium text-foreground">
                        {device.model || device.serial}
                      </span>
                      <Badge variant="outline" className="text-[11px] font-normal">
                        {device.transport === "tcpip" ? "Wi-Fi" : "USB"}
                      </Badge>
                      {device.androidVersion && (
                        <span className="text-xs text-muted-foreground">
                          Android {device.androidVersion}
                        </span>
                      )}
                      {device.mirroring && (
                        <Badge variant="secondary" className="text-[11px]">
                          投屏中
                        </Badge>
                      )}
                    </div>
                    <span className="font-mono text-xs text-muted-foreground break-all">
                      {device.serial}
                      {!online && device.issue ? ` · ${device.issue}` : ""}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {online && (
                      <Button
                        type="button"
                        variant={device.isDefault ? "secondary" : "outline"}
                        size="sm"
                        className="h-8"
                        disabled={busy || device.isDefault}
                        onClick={() =>
                          void updateConfig(
                            { defaultSerial: device.serial },
                            `已将 ${device.model || device.serial} 设为默认设备`
                          )
                        }
                      >
                        {device.isDefault ? "默认设备" : "设为默认"}
                      </Button>
                    )}

                    {online && device.transport === "usb" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={busy}
                        onClick={() =>
                          void runAction(`tcpip:${device.serial}`, async () => {
                            const res = await source.enableTcpip(device.serial)
                            const latest = await source.read()
                            setValue(latest)
                            notifyToast(`已开启无线连接 ${res.address}`, {
                              tone: "success",
                            })
                          })
                        }
                      >
                        转无线
                      </Button>
                    )}

                    {device.transport === "tcpip" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={busy}
                        onClick={() =>
                          void runAction(`disconnect:${device.serial}`, async () => {
                            await source.disconnectWireless(device.serial)
                            const latest = await source.read()
                            setValue(latest)
                          })
                        }
                      >
                        <WifiOff className="size-3.5" />
                        断开
                      </Button>
                    )}

                    {online &&
                      (device.mirroring ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={busy}
                          onClick={() =>
                            void runAction(`stop-mirror:${device.serial}`, async () => {
                              await source.stopMirror(device.serial)
                              const latest = await source.read()
                              setValue(latest)
                            })
                          }
                        >
                          <Square className="size-3.5" />
                          停止投屏
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          disabled={!installation?.canMirror || busy}
                          onClick={() =>
                            void runAction(`start-mirror:${device.serial}`, async () => {
                              await source.startMirror({ serial: device.serial })
                              const latest = await source.read()
                              setValue(latest)
                            })
                          }
                        >
                          <MonitorPlay className="size-3.5" />
                          投屏
                        </Button>
                      ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* Card 2 · 投屏偏好 */}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b">
          <span className="font-medium text-foreground">投屏分辨率</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {maxSizeOptions.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={cfg.mirrorMaxSize === opt.value ? "secondary" : "outline"}
                size="sm"
                className="h-8"
                disabled={busy}
                onClick={() =>
                  void updateConfig({ mirrorMaxSize: opt.value })
                }
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="divide-y pt-1">
          <PolicyRow
            id="android-mirror-screen-off"
            title="投屏时关闭手机屏幕（--turn-screen-off）"
            checked={cfg.mirrorScreenOff}
            disabled={busy}
            onCheckedChange={(checked) =>
              void updateConfig({ mirrorScreenOff: checked })
            }
          />
          <PolicyRow
            id="android-mirror-stay-awake"
            title="投屏期间保持唤醒（--stay-awake）"
            checked={cfg.mirrorStayAwake}
            disabled={busy}
            onCheckedChange={(checked) =>
              void updateConfig({ mirrorStayAwake: checked })
            }
          />
          <PolicyRow
            id="android-mirror-readonly"
            title="投屏窗口默认只读（--no-control）"
            hint={cfg.readOnly ? "已随全局只读模式强制启用" : undefined}
            checked={cfg.readOnly || cfg.mirrorReadOnly}
            disabled={busy || cfg.readOnly}
            onCheckedChange={(checked) =>
              void updateConfig({ mirrorReadOnly: checked })
            }
          />
        </div>
      </section>

      {/* Card 3 · 安全边界 */}
      <section className="rounded-xl border bg-card p-4">
        <div className="pb-3 border-b font-medium text-foreground">
          安全边界
        </div>
        <div className="divide-y pt-1">
          <PolicyRow
            id="android-readonly"
            title="只读模式"
            hint="仅允许观察与截图，禁止触控、输入、应用启停与文件写入"
            checked={cfg.readOnly}
            disabled={busy}
            onCheckedChange={(checked) => void updateConfig({ readOnly: checked })}
          />
          <PolicyRow
            id="android-clipboard"
            title="允许访问剪贴板"
            hint="读取或写入手机剪贴板内容"
            checked={cfg.allowClipboard}
            disabled={busy || cfg.readOnly}
            onCheckedChange={(checked) =>
              void updateConfig({ allowClipboard: checked })
            }
          />
          <PolicyRow
            id="android-app-lifecycle"
            title="允许启动与停止应用"
            checked={cfg.allowAppLifecycle}
            disabled={busy || cfg.readOnly}
            onCheckedChange={(checked) =>
              void updateConfig({ allowAppLifecycle: checked })
            }
          />
          <PolicyRow
            id="android-apk-install"
            title="允许安装与卸载 APK"
            checked={cfg.allowApkInstall}
            disabled={busy || cfg.readOnly}
            onCheckedChange={(checked) =>
              void updateConfig({ allowApkInstall: checked })
            }
          />
          <PolicyRow
            id="android-file-transfer"
            title="允许文件传输"
            hint="向设备推送或从设备拉取文件"
            checked={cfg.allowFileTransfer}
            disabled={busy || cfg.readOnly}
            onCheckedChange={(checked) =>
              void updateConfig({ allowFileTransfer: checked })
            }
          />
        </div>
      </section>

      {/* Card 4 · scrcpy 与 ADB 运行环境 */}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot tone={envTone} />
            <span className="font-medium text-foreground">{envSummary}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={busy}
              onClick={() =>
                void runAction("probe-env", async () => {
                  const latest = await source.read()
                  setValue(latest)
                })
              }
            >
              <RefreshCw
                className={`size-3.5 ${pending === "probe-env" ? "animate-spin" : ""}`}
              />
              重新检测
            </Button>
            {installation?.state === "not-installed" && (
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={busy || !installation.packageManager}
                onClick={() => void runManage("install")}
              >
                <Download className="size-3.5" />
                安装
              </Button>
            )}
            {installation?.usable &&
              installation.packageManager &&
              installation.source !== "custom" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={busy}
                  onClick={() => void runManage("upgrade")}
                >
                  升级
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-8"
                  disabled={busy}
                  onClick={() => void runManage("uninstall")}
                >
                  卸载
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 pt-3 text-xs">
          <div className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-center">
            <span className="text-muted-foreground">发现来源</span>
            <span className="text-foreground">
              {sourceLabel(installation?.source ?? null)}
              {installation?.packageManager
                ? `（可用包管理器：${installation.packageManager}）`
                : ""}
            </span>
          </div>
          <div className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start">
            <span className="text-muted-foreground">scrcpy</span>
            <span className="font-mono break-all text-foreground">
              {installation?.scrcpyPath || "未检测到"}
            </span>
          </div>
          <div className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start">
            <span className="text-muted-foreground">adb</span>
            <span className="font-mono break-all text-foreground">
              {installation?.adbPath || "未检测到"}
            </span>
          </div>
          <div className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-center pt-1">
            <span className="text-muted-foreground">自定义目录</span>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={customPathDraft}
                onChange={(e) => setCustomPathDraft(e.target.value)}
                placeholder="留空则自动从系统 PATH 检测，例如 H:\工具\scrcpy-win64-v3.1"
                className="h-8 min-w-[200px] flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={busy}
                onClick={() =>
                  void updateConfig(
                    { scrcpyPath: customPathDraft.trim() },
                    "已保存 scrcpy 路径并刷新检测"
                  )
                }
              >
                保存
              </Button>
            </div>
          </div>
          {(() => {
            const cmd = manualInstallCommand(
              installation?.packageManager ?? null
            )
            if (
              !cmd ||
              (installation?.state !== "not-installed" &&
                operation?.state !== "failed")
            ) {
              return null
            }
            return (
              <div className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start pt-1">
                <span className="text-muted-foreground sm:pt-1.5">终端安装</span>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                    {cmd}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(cmd)
                        .then(() =>
                          notifyToast("已复制终端安装命令", { tone: "success" })
                        )
                        .catch(() =>
                          notifyToast("复制失败，请手动选中命令复制", {
                            tone: "error",
                          })
                        )
                    }}
                  >
                    <Copy className="size-3.5" />
                    复制
                  </Button>
                </div>
              </div>
            )
          })()}
        </div>
      </section>

      {operation && (
        <section className="rounded-xl border bg-card p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot
                tone={
                  operation.state === "running"
                    ? "warn"
                    : operation.state === "succeeded"
                      ? "ok"
                      : operation.state === "cancelled"
                        ? "idle"
                        : "error"
                }
              />
              <span className="font-medium text-foreground">
                {operation.phase}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {operation.state === "running" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={pending === "cancel-manage"}
                  onClick={() => void runCancelManage()}
                >
                  {pending === "cancel-manage" ? "正在取消..." : "取消"}
                </Button>
              ) : (
                <span className="text-muted-foreground">
                  {operation.endedAt
                    ? new Date(operation.endedAt).toLocaleTimeString()
                    : ""}
                </span>
              )}
            </div>
          </div>
          {(operation.state === "running" ||
            (operation.logs && operation.logs.length > 0)) && (
            <pre
              ref={logBoxRef}
              className="mt-2.5 max-h-56 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/90"
            >
              {operation.logs && operation.logs.length > 0
                ? operation.logs.join("\n")
                : "等待包管理器输出..."}
            </pre>
          )}
          {operation.error && (
            <p className="mt-2 text-destructive break-words">{operation.error}</p>
          )}
        </section>
      )}
    </div>
  )
}

const plugin: PluginWebModule = {
  apiVersion: 1,
  id,
  ownsConfiguration: true,
  pages: [{ id: "android", component: () => <Page /> }],
}

export default plugin
