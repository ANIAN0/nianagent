import { useEffect, useState } from "react"
import { Timer } from "lucide-react"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import type { ConversationSnapshot } from "@/contracts/rpc.generated"
import "./execution-inline-status.css"

function RetryWait({ deadline }: { deadline?: number }) {
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    if (deadline === undefined || !Number.isFinite(deadline)) return
    const interval = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [deadline])
  const seconds =
    deadline !== undefined && Number.isFinite(deadline)
      ? Math.max(0, Math.ceil((deadline - clock) / 1000))
      : undefined
  return (
    <span role="timer" aria-live="off">
      {seconds === undefined
        ? "等待下一次尝试"
        : seconds > 0
          ? `${seconds} 秒后重试`
          : "即将重试"}
    </span>
  )
}

/** Inline retry wait row at the tail of the message stream. */
export function ExecutionInlineStatus({
  runtime,
}: {
  runtime: NonNullable<ConversationSnapshot["runtime"]>
}) {
  if (runtime.phase !== "retrying") return null
  const deadline = runtime.retryAt ? Date.parse(runtime.retryAt) : undefined
  const attempt = runtime.attempt
  const attempts =
    attempt === undefined
      ? undefined
      : runtime.maxAttempts === undefined
        ? `第 ${attempt} 次重试`
        : `第 ${attempt} / ${runtime.maxAttempts} 次重试`
  return (
    <Marker className="execution-inline-retry">
      <MarkerIcon>
        <Timer />
      </MarkerIcon>
      <MarkerContent>
        <div
          className="execution-inline-retry-heading"
          role="status"
          aria-atomic="true"
        >
          <strong>
            {runtime.retrySource === "compaction"
              ? "等待重试上下文压缩"
              : "等待重试模型请求"}
          </strong>
          {attempts && <span>{attempts}</span>}
          <RetryWait key={runtime.retryAt ?? "unknown"} deadline={deadline} />
        </div>
        {runtime.reason && (
          <p className="execution-inline-retry-detail">{runtime.reason}</p>
        )}
      </MarkerContent>
    </Marker>
  )
}
