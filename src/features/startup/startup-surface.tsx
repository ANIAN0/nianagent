import { useEffect, useRef, useState } from "react"
import {
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Power,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import "./startup-surface.css"

export type StartupStep = {
  id: string
  label: string
  status: "complete" | "active" | "pending" | "failed"
  detail?: string
}

export type StartupSurfaceProps = {
  status: "starting" | "failed"
  steps: StartupStep[]
  message?: string | null
  failureTitle?: string
  /** 仅允许受控阶段、版本与安全原因，调用方不得传原始异常、配置或凭据。 */
  diagnostics?: string
  pending?: "retry" | "exit" | null
  retryLabel?: string
  exitInstruction?: string | null
  onRetry?: () => void
  onExit?: () => void
}

/** 启动页只投影真实状态；页面本身不推进阶段，也不决定宿主已就绪。 */
export function StartupSurface({
  status,
  steps,
  message,
  failureTitle,
  diagnostics = "",
  pending = null,
  retryLabel = "重试",
  exitInstruction,
  onRetry,
  onExit,
}: StartupSurfaceProps) {
  const [details, setDetails] = useState(false)
  const [copyState, setCopyState] = useState<{
    diagnostics: string
    status: "copying" | "copied" | "failed"
  } | null>(null)
  const copying = useRef(false)
  const lifetime = useRef(0)
  useEffect(() => {
    lifetime.current += 1
    return () => {
      lifetime.current += 1
    }
  }, [])
  const failed = steps.find((step) => step.status === "failed")
  const active = steps.find((step) => step.status === "active")
  const title =
    status === "failed"
      ? (failureTitle ?? `${failed?.label ?? "启动"}失败`)
      : (active?.label ?? "正在启动 Moon")
  const copied =
    copyState?.diagnostics === diagnostics ? copyState.status : null

  return (
    <main className="startup-surface">
      <section aria-labelledby="startup-wordmark">
        <h1 id="startup-wordmark">Moon</h1>
        {status === "starting" ? (
          <div className="startup-progress" role="status">
            <span className="startup-spinner" aria-hidden="true" />
            <p>{title}</p>
          </div>
        ) : (
          <div className="startup-failure" role="status">
            <h2>
              <CircleAlert aria-hidden="true" />
              {title}
            </h2>
            <p>
              {message ?? failed?.detail ?? "未能完成启动，请按当前提示处理。"}
            </p>
            {pending === "retry" && (
              <p className="startup-retrying">
                <span className="startup-spinner" aria-hidden="true" />
                正在重试…
              </p>
            )}
          </div>
        )}
        {status === "failed" && (
          <>
            <div className="startup-actions">
              {onRetry && (
                <Button size="sm" disabled={pending !== null} onClick={onRetry}>
                  <RefreshCw data-icon="inline-start" />
                  {pending === "retry" ? "正在重试…" : retryLabel}
                </Button>
              )}
              {diagnostics && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={copied === "copying" || pending === "exit"}
                  onClick={() => {
                    if (copying.current) return
                    copying.current = true
                    const current = lifetime.current
                    const text = diagnostics
                    setCopyState({ diagnostics: text, status: "copying" })
                    // 复制反馈只属于点击时的安全诊断；阶段变化后不能显示旧复制成功。
                    void Promise.resolve()
                      .then(() => navigator.clipboard.writeText(text))
                      .then(() => {
                        if (lifetime.current === current)
                          setCopyState({ diagnostics: text, status: "copied" })
                      })
                      .catch(() => {
                        if (lifetime.current === current)
                          setCopyState({ diagnostics: text, status: "failed" })
                      })
                      .finally(() => {
                        copying.current = false
                      })
                  }}
                >
                  <Clipboard data-icon="inline-start" />
                  {copied === "copying"
                    ? "正在复制…"
                    : copied === "copied"
                      ? "诊断已复制"
                      : copied === "failed"
                        ? "复制失败，再试一次"
                        : "复制诊断信息"}
                </Button>
              )}
              {onExit && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending !== null}
                  onClick={onExit}
                >
                  <Power data-icon="inline-start" />
                  {pending === "exit" ? "正在退出…" : "退出 Moon"}
                </Button>
              )}
            </div>
            {exitInstruction && (
              <p className="startup-exit-instruction" role="status">
                {exitInstruction}
              </p>
            )}
          </>
        )}
        <Collapsible
          open={details}
          onOpenChange={setDetails}
          className="startup-disclosure"
        >
          <CollapsibleContent>
            <Separator />
            <ol className="startup-details">
              {steps.map((step) => (
                <li key={step.id} data-status={step.status}>
                  {step.status === "complete" ? (
                    <Check aria-hidden="true" />
                  ) : step.status === "active" ? (
                    <span className="startup-spinner" aria-hidden="true" />
                  ) : step.status === "failed" ? (
                    <CircleAlert aria-hidden="true" />
                  ) : (
                    <span className="startup-step-pending" aria-hidden="true" />
                  )}
                  <span>
                    <strong>{step.label}</strong>
                    {step.detail && <small>{step.detail}</small>}
                  </span>
                  <span className="sr-only">
                    {step.status === "complete"
                      ? "已完成"
                      : step.status === "active"
                        ? "进行中"
                        : step.status === "failed"
                          ? "失败"
                          : "尚未执行"}
                  </span>
                </li>
              ))}
            </ol>
            <Separator />
          </CollapsibleContent>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="startup-toggle">
              {details ? "收起详情" : "查看详情"}
              <ChevronDown data-icon="inline-end" aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
        </Collapsible>
      </section>
    </main>
  )
}
