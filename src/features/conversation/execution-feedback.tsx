import { useEffect, useState } from "react"
import { CircleAlert, Layers, LoaderCircle, Timer, Wrench } from "lucide-react"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ConversationSnapshot } from "@/features/models/model-contract.generated"
import "./execution-feedback.css"

export type ExecutionFeedbackProps = {
  runtime?: ConversationSnapshot["runtime"]
  stopping?: boolean
  notice?: ConversationSnapshot["notice"]
}

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

/** Shows recorded Pi activity. The local clock only updates the server's retry deadline. */
export function ExecutionFeedback({
  runtime,
  stopping = false,
  notice,
}: ExecutionFeedbackProps) {
  const retryAt = runtime?.phase === "retrying" ? runtime.retryAt : undefined
  const deadline = retryAt ? Date.parse(retryAt) : undefined
  if (!runtime && !stopping && !notice) return null

  const phase = stopping ? "stopping" : runtime?.phase
  const title = {
    responding: "正在回复",
    tool: "正在执行工具",
    retrying:
      runtime?.retrySource === "compaction"
        ? "等待重试上下文压缩"
        : "等待重试模型请求",
    compacting: "正在压缩上下文",
    stopping: "正在停止",
  }[phase ?? "responding"]
  const Icon =
    phase === "tool"
      ? Wrench
      : phase === "retrying"
        ? Timer
        : phase === "compacting"
          ? Layers
          : LoaderCircle
  const attempt = runtime?.attempt
  const attempts =
    attempt === undefined
      ? undefined
      : runtime?.maxAttempts === undefined
        ? `第 ${attempt} 次重试`
        : `第 ${attempt} / ${runtime.maxAttempts} 次重试`
  return (
    <div className="flex flex-col gap-2">
      {phase && (
        <Marker className="execution-feedback" data-phase={phase}>
          <MarkerIcon>
            <Icon />
          </MarkerIcon>
          <MarkerContent>
            <div
              className="execution-feedback-heading"
              role="status"
              aria-atomic="true"
            >
              <strong>{title}</strong>
              {phase === "tool" && runtime?.toolName && (
                <span>{runtime.toolName}</span>
              )}
              {phase === "retrying" && attempts && <span>{attempts}</span>}
            </div>
            {phase === "retrying" && (
              <p className="execution-feedback-detail">
                {runtime?.reason && <span>{runtime.reason}</span>}
                <RetryWait key={retryAt ?? "unknown"} deadline={deadline} />
              </p>
            )}
            {phase === "compacting" && (
              <p className="execution-feedback-detail">
                正在整理对话历史，保留继续对话需要的上下文。
              </p>
            )}
            {phase === "stopping" && (
              <p className="execution-feedback-detail">
                正在等待当前执行结束，已完成的操作会保留。
              </p>
            )}
          </MarkerContent>
        </Marker>
      )}
      {notice && (
        <Alert role="status" className="execution-notice">
          <CircleAlert aria-hidden />
          <AlertTitle>上下文压缩未完成</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
