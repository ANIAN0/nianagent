import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { Copy, ExternalLink, RefreshCw, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { callPlugin } from "@/features/plugins/plugin-service"

export const id = "remote-access"
export type RemoteStatus = {
  online: boolean
  clients: number
  issue: string
  url: string
}
export function Page() {
  const [status, setStatus] = useState<RemoteStatus>()
  const [qr, setQr] = useState({ url: "", data: "", error: "" })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let reading = false
    const read = () => {
      if (reading || document.hidden) return
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
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message)
        })
        .finally(() => {
          reading = false
        })
    }
    read()
    const timer = setInterval(read, 2000)
    return () => {
      controller.abort()
      clearInterval(timer)
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
  return (
    <div className="flex flex-col gap-6">
      <RemoteConnectionView
        status={status}
        qr={qr.url === status?.url ? qr.data : ""}
        error={error || (qr.url === status?.url ? qr.error : "")}
        busy={busy}
        onCopy={() => {
          if (status?.url)
            void navigator.clipboard
              .writeText(status.url)
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
          } catch (error) {
            setError(error instanceof Error ? error.message : "重置未确认。")
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
      if (document.hidden) return
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
          /* 读取失败保留上一次结果；空列表时本区不渲染。 */
        })
    }
    read()
    const timer = setInterval(read, 2000)
    return () => {
      controller.abort()
      clearInterval(timer)
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作未完成。")
    } finally {
      setBusy(false)
    }
  }
  if (!items.length) return null
  return (
    <section className="flex flex-col gap-2 text-sm" aria-label="设备信任">
      <h2 className="text-[13px] font-medium">设备信任</h2>
      {error && <p role="alert">{error}</p>}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={`${item.state}:${item.id}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span
              className={
                item.state === "pending"
                  ? "font-medium"
                  : "text-muted-foreground"
              }
            >
              {item.state === "pending" ? "待确认设备" : "已信任设备"}
              {item.online ? " · 在线" : ""}
            </span>
            <code className="text-xs text-muted-foreground">
              {item.id.slice(0, 12)}…
            </code>
            {item.state === "pending" ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void act("trust", item.id)}
              >
                信任此设备
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void act("forget", item.id)}
              >
                移除
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        新设备完成配对后需在此确认才能执行任何远程操作；重置连接会清空此列表。
      </p>
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
      .catch((error) => {
        if (!controller.signal.aborted) setIssue(error.message)
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
          .catch((error) => setIssue(error.message))
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
      className="flex w-full flex-col gap-3 rounded-xl border bg-card p-5"
      aria-label="未完成的远程上传"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">未完成的远程上传</h3>
          <p className="text-xs text-muted-foreground">
            断开或刷新后遗留的接收可取消占位，保留原文件与记录。
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onRefresh}>
          <RefreshCw className="size-3.5" />
          刷新记录
        </Button>
      </div>
      {issue && (
        <Alert>
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
              className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1 break-all">
                <p className="text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {item.offset ?? "未知"} / {item.bytes ?? "未知"} 字节
                  {item.uncertain
                    ? " · 准备或归属结果待核对，原副本保留"
                    : " · 接收未结束"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onCancel(item)}
              >
                取消接收并保留副本
              </Button>
            </div>
          ))}
        </div>
      )}
      {more && (
        <p className="text-xs text-muted-foreground">
          还有其他记录；处理后重新读取。
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
  onCopy,
  onReset,
}: {
  status?: RemoteStatus
  qr: string
  error: string
  busy: boolean
  onCopy: () => void
  onReset: () => void
}) {
  return (
    <section
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
      aria-label="远程访问连接"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-sm font-semibold">远程访问连接</h3>
          <Badge variant={status?.online ? "secondary" : "outline"}>
            {status ? (status.online ? "在线" : "未连接") : "读取中"}
          </Badge>
          {status && (
            <span className="text-xs text-muted-foreground">
              已连接 {status.clients} 端
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={busy || !status}
          onClick={onReset}
        >
          <RotateCcw className="size-3.5" />
          重置全部连接
        </Button>
      </div>
      {error && (
        <Alert>
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
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {qr && (
                <div className="w-fit shrink-0 rounded-xl border bg-white p-2.5">
                  <img
                    src={qr}
                    width={176}
                    height={176}
                    alt="连接本机Moon的二维码"
                    className="block"
                  />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    readOnly
                    aria-label="远程连接地址"
                    className="min-w-[180px] flex-1 font-mono text-xs"
                    value={status.url}
                  />
                  <Button variant="outline" size="sm" onClick={onCopy}>
                    <Copy className="size-3.5" />
                    复制链接
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={status.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" />
                      打开
                    </a>
                  </Button>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  通过此链接或二维码可控制本机 Moon
                  的正常会话，请只交给需要连接的人。公网手机访问需配置可访问的
                  HTTPS 地址。
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default {
  id,
  apiVersion: 1 as const,
  pages: [{ id: "remote", component: Page }],
}
