import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import "./status-message.css"

/** DSH-style durable status, separate from transient notifications. */
export function StatusMessage({
  title,
  message,
  code,
  severity = "error",
  role = "status",
}: {
  title: string
  message: string
  code?: string
  severity?: "error" | "warning" | "info"
  /** 静态记录（catalog 等，后续批次）按需传 "group" 关闭挂载播报；默认 "status" 保持现行为。 */
  role?: "status" | "group"
}) {
  return (
    <Marker
      className="operation-status-message"
      data-severity={severity}
      role={role}
    >
      <MarkerIcon className="operation-status-dot" />
      <MarkerContent>
        <strong className="operation-status-title">{title}</strong>
        <span>{message}</span>
      </MarkerContent>
      {code && (
        <code className="operation-status-code" title={code}>
          {code}
        </code>
      )}
    </Marker>
  )
}
