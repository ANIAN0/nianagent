import { useEffect, useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import QRCode from "qrcode"
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  RefreshCw,
  RotateCcw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { notifyToast } from "@/components/ui/notification-toast"
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  callPlugin,
  pluginsChanged,
  subscribePluginEvent,
} from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import { rpcCall } from "@/lib/rpc/client"

export const id = "remote-access"
export type RemoteStatus = {
  online: boolean
  clients: number
  issue: string
  url: string
}

type RemoteConfigState = {
  revision: number
  enabled: boolean
  origin: string
}

const errorMessage = (reason: unknown, fallback: string) =>
  reason instanceof Error
    ? reason.message
    : typeof reason === "string" && reason.trim()
      ? reason
      : fallback

const parseOriginConfig = (raw: string) => {
  try {
    const parsed = JSON.parse(raw) as { origin?: unknown }
    return typeof parsed.origin === "string" ? parsed.origin : ""
  } catch {
    return ""
  }
}

export function Page() {
  const [status, setStatus] = useState<RemoteStatus>()
  const [qr, setQr] = useState({ url: "", data: "", error: "" })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [configState, setConfigState] = useState<RemoteConfigState>({
    revision: 0,
    enabled: true,
    origin: "",
  })
  const [originDraft, setOriginDraft] = useState("")
  const [savingOrigin, setSavingOrigin] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let reading = false
    const read = () => {
      if (reading || document.hidden || controller.signal.aborted) return
      reading = true
      void callPlugin<{ value: RemoteStatus }>(
        id,
        "connection",
        {},
        undefined,
        controller.signal
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setStatus(result.value)
            setError("")
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted) {
            setError(errorMessage(reason, "远程连接状态读取失败。"))
          }
        })
        .finally(() => {
          reading = false
        })
    }
    read()
    void rpcCall("pluginList", {}, controller.signal)
      .then((plugins) => {
        if (controller.signal.aborted) return
        const item = plugins.find((entry) => entry.id === id)
        if (!item) return
        const origin = parseOriginConfig(item.configuration)
        setConfigState({
          revision: item.revision,
          enabled: item.enabled,
          origin,
        })
        setOriginDraft(origin)
      })
      .catch(() => {})
    const unsubscribe = subscribePluginEvent(id, "state-changed", read)
    const onVisible = () => {
      if (!document.hidden) read()
    }
    document.addEventListener("visibilitychange", onVisible)
    // 桌面端由宿主事件驱动；非桌面远程 Web 保留 2s 轮询兜底
    const timer = isTauri() ? undefined : setInterval(read, 2000)
    return () => {
      controller.abort()
      unsubscribe()
      document.removeEventListener("visibilitychange", onVisible)
      if (timer) clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let active = true
    if (status?.url)
      void QRCode.toDataURL(status.url, { width: 240, margin: 2 })
        .then((value) => {
          if (active) setQr({ url: status.url, data: value, error: "" })
        })
        .catch(() => {
          if (active)
            setQr({
              url: status.url,
              data: "",
              error: "二维码未能生成，请使用连接链接。",
            })
        })
    return () => {
      active = false
    }
  }, [status?.url])

  const saveOrigin = async () => {
    const trimmed = originDraft.trim()
    if (!trimmed || savingOrigin) return
    setSavingOrigin(true)
    setError("")
    try {
      const plugins = await rpcCall("pluginList", {})
      const current = plugins.find((entry) => entry.id === id)
      if (!current) throw new Error("远程访问插件当前不可用，请刷新后重试。")
      const updated = await rpcCall("pluginConfigure", {
        id,
        revision: current.revision,
        enabled: current.enabled,
        configuration: JSON.stringify({ origin: trimmed }),
      })
      const nextOrigin = parseOriginConfig(updated.configuration)
      setConfigState({
        revision: updated.revision,
        enabled: updated.enabled,
        origin: nextOrigin,
      })
      setOriginDraft(nextOrigin)
      pluginsChanged()
      notifyToast("网页入口地址已更新", { tone: "success" })
    } catch (reason) {
      setError(errorMessage(reason, "配置保存失败。"))
    } finally {
      setSavingOrigin(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <RemoteConnectionView
        status={status}
        qr={qr.url === status?.url ? qr.data : ""}
        error={error || (qr.url === status?.url ? qr.error : "")}
        busy={busy}
        copied={copied}
        origin={originDraft}
        originDirty={originDraft.trim() !== configState.origin}
        savingOrigin={savingOrigin}
        onOriginChange={setOriginDraft}
        onSaveOrigin={() => void saveOrigin()}
        onCopy={() => {
          if (!status?.url) return
          void navigator.clipboard
            .writeText(status.url)
            .then(() => {
              setCopied(true)
              notifyToast("连接链接已复制", { tone: "success" })
              window.setTimeout(() => setCopied(false), 1600)
            })
            .catch(() => setError("链接复制失败，请重新复制。"))
        }}
        onReset={async () => {
          setBusy(true)
          setError("")
          try {
            const result = await callPlugin<{ value: RemoteStatus }>(
              id,
              "reset",
              {}
            )
            setStatus(result.value)
            notifyToast("远程连接已重置", { tone: "success" })
          } catch (reason) {
            setError(errorMessage(reason, "重置未确认。"))
          } finally {
            setBusy(false)
          }
        }}
      />
      <Devices />
      <UploadReservations />
    </div>
  )
}

type DeviceRecord = {
  id: string
  state: "trusted" | "pending"
  online: boolean
}

/** 设备信任区：新设备完成配对后须在此确认；未确认设备无任何远程操作。 */
function Devices() {
  const [items, setItems] = useState<DeviceRecord[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const read = () => {
      if (document.hidden || controller.signal.aborted) return
      void callPlugin<{ value: { items: DeviceRecord[] } }>(
        id,
        "clients",
        {},
        undefined,
        controller.signal
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setItems(result.value.items)
            setError("")
          }
        })
        .catch(() => {
          /* 读取失败保留上一次结果。 */
        })
    }
    read()
    const unsubscribe = subscribePluginEvent(id, "state-changed", read)
    const onVisible = () => {
      if (!document.hidden) read()
    }
    document.addEventListener("visibilitychange", onVisible)
    const timer = isTauri() ? undefined : setInterval(read, 2000)
    return () => {
      controller.abort()
      unsubscribe()
      document.removeEventListener("visibilitychange", onVisible)
      if (timer) clearInterval(timer)
    }
  }, [])

  const act = async (operation: "trust" | "forget", deviceId: string) => {
    setBusy(true)
    setError("")
    try {
      const result = await callPlugin<{ value: { items: DeviceRecord[] } }>(
        id,
        operation,
        { id: deviceId }
      )
      setItems(result.value.items)
      notifyToast(
        operation === "trust" ? "已信任该设备" : "已移除该设备",
        { tone: "success" }
      )
    } catch (reason) {
      setError(errorMessage(reason, "操作未完成。"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      aria-label="设备信任"
    >
      <h3 className="text-sm font-medium">设备信任</h3>
      {error && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!items.length ? (
        <Empty className="border py-6">
          <EmptyHeader>
            <EmptyTitle>暂无已配对或待确认设备</EmptyTitle>
            <EmptyDescription>
              远程客户端扫码握手后将在此显示，确认信任后方可执行远程操作。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={`${item.state}:${item.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className={
                    item.online
                      ? "size-2 shrink-0 rounded-full bg-emerald-500"
                      : "size-2 shrink-0 rounded-full bg-muted-foreground/40"
                  }
                />
                <Badge
                  variant={item.state === "pending" ? "secondary" : "outline"}
                  className="font-normal"
                >
                  {item.state === "pending" ? "待确认" : "已信任"}
                </Badge>
                <code className="font-mono text-muted-foreground">
                  {item.id.slice(0, 12)}…
                </code>
              </div>
              {item.state === "pending" ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void act("trust", item.id)}
                >
                  信任
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void act("forget", item.id)}
                >
                  移除
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type UploadReservation = {
  token: string
  version: string
  name: string
  bytes: number | null
  offset: number | null
  uncertain: boolean
}

function UploadReservations() {
  const [items, setItems] = useState<UploadReservation[]>([])
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState("")
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void callPlugin<{ value: { items: UploadReservation[]; more: boolean } }>(
      id,
      "uploadReservations",
      {},
      undefined,
      controller.signal
    )
      .then(({ value }) => {
        if (controller.signal.aborted) return
        setItems(value.items)
        setMore(value.more)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setIssue(errorMessage(reason, "上传记录读取失败。"))
        }
      })
    return () => controller.abort()
  }, [revision])

  return (
    <UploadReservationsView
      items={items}
      more={more}
      busy={busy}
      issue={issue}
      onRefresh={() => {
        setIssue("")
        setRevision((value) => value + 1)
      }}
      onCancel={(item) => {
        setBusy(true)
        setIssue("")
        void callPlugin(id, "uploadIsolate", {
          token: item.token,
          version: item.version,
        })
          .then(() => {
            notifyToast("已取消接收占位并保留副本", { tone: "success" })
          })
          .catch((reason) => setIssue(errorMessage(reason, "取消失败。")))
          .finally(() => {
            setBusy(false)
            setRevision((value) => value + 1)
          })
      }}
    />
  )
}

export function UploadReservationsView({
  items,
  more,
  busy,
  issue,
  onRefresh,
  onCancel,
}: {
  items: UploadReservation[]
  more: boolean
  busy: boolean
  issue: string
  onRefresh: () => void
  onCancel: (item: UploadReservation) => void
}) {
  return (
    <section
      className="flex w-full flex-col gap-3 rounded-xl border bg-card p-4"
      aria-label="未完成的远程上传"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">未完成的远程上传</h3>
        <Button
          variant="outline"
          className="text-xs"
          disabled={busy}
          onClick={onRefresh}
        >
          <RefreshCw className="size-3.5" />
          刷新
        </Button>
      </div>
      {issue && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{issue}</AlertDescription>
        </Alert>
      )}
      {!items.length ? (
        <p role="status" className="text-xs text-muted-foreground">
          没有未完成的接收占位。
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div
              key={item.token}
              className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0 flex-1 break-all">
                <p className="text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {item.offset ?? "未知"} / {item.bytes ?? "未知"} 字节
                  {item.uncertain
                    ? " · 待核对，原副本保留"
                    : " · 接收未结束"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onCancel(item)}
              >
                取消并保留副本
              </Button>
            </div>
          ))}
        </div>
      )}
      {more && (
        <p className="text-xs text-muted-foreground">
          还有其他记录，处理后刷新查看。
        </p>
      )}
    </section>
  )
}

export function RemoteConnectionView({
  status,
  qr,
  error,
  busy,
  copied = false,
  origin = "",
  originDirty = false,
  savingOrigin = false,
  onOriginChange,
  onSaveOrigin,
  onCopy,
  onReset,
}: {
  status?: RemoteStatus
  qr: string
  error: string
  busy: boolean
  copied?: boolean
  origin?: string
  originDirty?: boolean
  savingOrigin?: boolean
  originNotice?: string
  onOriginChange?: (next: string) => void
  onSaveOrigin?: () => void
  onCopy: () => void
  onReset: () => void
}) {
  return (
    <section
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
      aria-label="远程访问连接"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className={
              status?.online
                ? "size-2 shrink-0 rounded-full bg-emerald-500"
                : "size-2 shrink-0 rounded-full bg-muted-foreground/40"
            }
          />
          <h3 className="text-sm font-medium">
            {status ? (status.online ? "在线" : "未连接") : "读取中"}
          </h3>
          {status && status.clients > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              已连接 {status.clients} 端
            </span>
          )}
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="destructive"
              className="text-xs"
              disabled={busy || !status}
            >
              <RotateCcw className="size-3.5" />
              重置连接
            </Button>
          </DialogTrigger>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>重置全部远程连接？</DialogTitle>
              <DialogDescription>
                现有连接链接和所有已信任设备都会立即失效，需要重新扫码配对。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">取消</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="destructive" onClick={onReset}>
                  确认重置
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!status ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : (
        <>
          {status.issue && (
            <p role="status" className="text-xs text-muted-foreground">
              {status.issue}
            </p>
          )}
          {status.url && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {qr && (
                <div className="w-fit shrink-0 rounded-xl border bg-white p-2">
                  <img
                    src={qr}
                    width={160}
                    height={160}
                    alt="连接本机 Moon 的二维码"
                    className="block"
                  />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    readOnly
                    aria-label="远程连接地址"
                    className="min-w-[180px] flex-1 font-mono text-xs"
                    value={status.url}
                  />
                  <Button
                    variant="outline"
                    className="text-xs"
                    onClick={onCopy}
                  >
                    {copied ? (
                      <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copied ? "已复制" : "复制"}
                  </Button>
                  <Button variant="outline" className="text-xs" asChild>
                    <a href={status.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" />
                      打开
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  仅向信任对象提供此链接或二维码。
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {onOriginChange && onSaveOrigin && (
        <details className="group border-t pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            <span>网页入口地址（evework origin）</span>
          </summary>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              aria-label="evework 网页地址"
              className="min-w-[200px] flex-1 font-mono text-xs"
              value={origin}
              placeholder="https://..."
              onChange={(event) => onOriginChange(event.target.value)}
            />
            <Button
              variant="outline"
              className="text-xs"
              disabled={savingOrigin || !originDirty || !origin.trim()}
              onClick={onSaveOrigin}
            >
              {savingOrigin ? "保存中…" : "保存"}
            </Button>
          </div>
        </details>
      )}
    </section>
  )
}

const plugin: PluginWebModule = {
  id,
  apiVersion: 1,
  ownsConfiguration: true,
  pages: [{ id: "remote", component: Page }],
}
export default plugin
