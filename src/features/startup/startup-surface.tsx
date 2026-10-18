import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, CircleAlert, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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

/** 阶段提示出现延迟：快启动保持纯呼吸点，慢启动才开口交代。 */
const STAGE_REVEAL_DELAY = 1500

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
  const [showStage, setShowStage] = useState(false)
  const [copyState, setCopyState] = useState<{
    diagnostics: string
    status: "copying" | "copied" | "failed"
  } | null>(null)
  const copying = useRef(false)
  const lifetime = useRef(0)
  useEffect(() => {
    const timer = window.setTimeout(
      () => setShowStage(true),
      STAGE_REVEAL_DELAY
    )
    return () => window.clearTimeout(timer)
  }, [])
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
  const currentIndex = steps.findIndex(
    (step) => step.status === "active" || step.status === "failed"
  )
  const copied =
    copyState?.diagnostics === diagnostics ? copyState.status : null

  const copyDiagnostics = () => {
    if (copying.current || !diagnostics) return
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
  }

  /* 失败时刻只有一个决定（是否重试）：唯一实体按钮是重试；
     披露、退出等次要动作全部是文字级，复制诊断收进它作用的详情里。 */
  const disclosureAvailable =
    (steps.length > 1 || !!diagnostics) && (status === "failed" || showStage)
  const detailsToggle = (
    <CollapsibleTrigger asChild>
      <button type="button" className="startup-toggle">
        {details ? "收起详情" : "查看详情"}
        <ChevronDown data-icon="inline-end" aria-hidden="true" />
      </button>
    </CollapsibleTrigger>
  )
  const exitAction = onExit ? (
    <button
      type="button"
      className="startup-toggle"
      disabled={pending !== null}
      onClick={onExit}
    >
      {pending === "exit" ? "正在退出…" : "退出 Moon"}
    </button>
  ) : null

  return (
    <main className="startup-surface" data-status={status}>
      <h1 id="startup-title" className="sr-only">
        Moon
      </h1>
      {status === "starting" ? (
        <div className="startup-wait" role="status">
          <span className="startup-dot" aria-hidden="true" />
          {showStage && <p className="startup-stage">{title}</p>}
          {showStage && currentIndex >= 0 && (
            <span className="sr-only">
              第 {currentIndex + 1} 步，共 {steps.length} 步
            </span>
          )}
        </div>
      ) : (
        <div className="startup-failure" role="status">
          <h2 key={title}>
            <CircleAlert aria-hidden="true" />
            {title}
          </h2>
          <p>
            {message ?? failed?.detail ?? "未能完成启动，请按当前提示处理。"}
          </p>
          {pending === "retry" && (
            <p className="startup-retrying">
              <span className="startup-dot" aria-hidden="true" />
              正在重试…
            </p>
          )}
        </div>
      )}
      {status === "failed" && onRetry && (
        <div className="startup-actions">
          <Button disabled={pending !== null} onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            {pending === "retry" ? "正在重试…" : retryLabel}
          </Button>
        </div>
      )}
      {/* 快启动保持纯呼吸点；慢启动或失败时开放阶段信息与详情。 */}
      {disclosureAvailable ? (
        <Collapsible
          open={details}
          onOpenChange={setDetails}
          className="startup-disclosure"
        >
          {status === "failed" ? (
            <div className="startup-secondary">
              {detailsToggle}
              {exitAction && (
                <span className="startup-secondary-sep" aria-hidden="true">
                  ·
                </span>
              )}
              {exitAction}
            </div>
          ) : (
            detailsToggle
          )}
          <CollapsibleContent>
            <ol className="startup-details">
              {steps.map((step) => (
                <li key={step.id} data-status={step.status}>
                  {step.status === "complete" ? (
                    <Check aria-hidden="true" />
                  ) : step.status === "active" ? (
                    <span className="startup-dot" aria-hidden="true" />
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
            {diagnostics && (
              <button
                type="button"
                className="startup-toggle startup-details-action"
                disabled={copied === "copying" || pending === "exit"}
                onClick={copyDiagnostics}
              >
                {copied === "copying"
                  ? "正在复制…"
                  : copied === "copied"
                    ? "诊断已复制"
                    : copied === "failed"
                      ? "复制失败，再试一次"
                      : "复制诊断信息"}
              </button>
            )}
          </CollapsibleContent>
        </Collapsible>
      ) : (
        status === "failed" &&
        exitAction && <div className="startup-secondary">{exitAction}</div>
      )}
      {status === "failed" && exitInstruction && (
        <p className="startup-exit-instruction" role="status">
          {exitInstruction}
        </p>
      )}
    </main>
  )
}
