import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
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
      <UploadReservations />
    </div>
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
      className="flex w-full flex-col items-start gap-3"
      aria-label="未完成的远程上传"
    >
      <h3>未完成的远程上传</h3>
      <p className="text-sm text-muted-foreground">
        断开或刷新后遗留的接收可以取消占位。此操作会阻止原上传继续接收，保留文件和原记录；已经准备或发送的材料不会被删除。
      </p>
      <Button variant="outline" disabled={busy} onClick={onRefresh}>
        重新读取接收记录
      </Button>
      {issue && <p role="alert">{issue}</p>}
      {!items.length && <p role="status">没有未完成的接收占位。</p>}
      {items.map((item) => (
        <div
          key={item.token}
          className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border p-3"
        >
          <div className="min-w-0 flex-1 break-all">
            <p>{item.name}</p>
            <p className="text-xs text-muted-foreground">
              {item.offset ?? "未知"} / {item.bytes ?? "未知"} 字节
              {item.uncertain
                ? " · 准备或归属结果待核对，原副本保留"
                : " · 接收未结束"}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onCancel(item)}
          >
            取消接收并保留副本
          </Button>
        </div>
      ))}
      {more && <p>还有其他记录；处理后重新读取。</p>}
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
    <div className="flex flex-col items-start gap-3">
      <p role="status">
        {status?.issue || "正在读取远程连接…"} · 已连接{status?.clients || 0}端
      </p>
      {error && <p role="alert">{error}</p>}
      {status?.url && (
        <>
          {qr && (
            <img src={qr} width={240} height={240} alt="连接本机Moon的二维码" />
          )}
          <a href={status.url} target="_blank" rel="noreferrer">
            打开连接链接
          </a>
          <Button variant="outline" onClick={onCopy}>
            复制链接
          </Button>
          <p className="text-sm text-muted-foreground">
            通过此链接可以控制本机Moon的正常会话，请只交给需要连接的人。公网手机需使用可访问的HTTPS地址。
          </p>
        </>
      )}
      <Button variant="outline" disabled={busy} onClick={onReset}>
        重置全部连接
      </Button>
    </div>
  )
}
