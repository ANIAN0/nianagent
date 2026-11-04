import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import { Check, ChevronDown, CircleAlert, Loader2, RefreshCw } from "lucide-react"
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

/** 详情外观可替换；披露状态、退出与诊断复制仍由启动页统一管理。 */
export type StartupDetailsViewProps = {
  status: "starting" | "failed"
  steps: StartupStep[]
  pending: "retry" | "exit" | null
  open: boolean
  onOpenChange: (open: boolean) => void
  retryAction: ReactNode
  exitAction: ReactNode
  copyAction: ReactNode
}

export type StartupFailureViewProps = {
  title: string
  message: string
  pending: "retry" | "exit" | null
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
  detailsView?: ComponentType<StartupDetailsViewProps>
  failureView?: ComponentType<StartupFailureViewProps>
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
  detailsView: DetailsView,
  failureView: FailureView,
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
  const [prevStatus, setPrevStatus] = useState<string | null>(null)
  if (prevStatus !== status) {
    setPrevStatus(status)
    // 失败即自动弹出异常详情并保持打开：重试与退出在弹窗内，离开失败态才收起。
    if (status === "failed") {
      if (DetailsView && (steps.length > 1 || diagnostics)) setDetails(true)
    } else {
      setDetails(false)
    }
  }
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
  const failureMessage =
    message ?? failed?.detail ?? "未能完成启动，请按当前提示处理。"

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

  /* 恢复由宿主决定，阶段与诊断按需披露。 */
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
      {pending === "exit" && (
        <Loader2
          className="size-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      退出 Moon
    </button>
  ) : null
  const copyAction = diagnostics ? (
    <button
      type="button"
      className="startup-toggle startup-details-action"
      disabled={copied === "copying" || pending === "exit"}
      onClick={copyDiagnostics}
      aria-live="polite"
    >
      {copied === "copying"
        ? "正在复制…"
        : copied === "copied"
          ? "诊断已复制"
          : copied === "failed"
            ? "复制失败，再试一次"
            : "复制诊断信息"}
    </button>
  ) : null

  const failureInDialog =
    status === "failed" && !!DetailsView && disclosureAvailable
  const retryAction =
    status === "failed" && onRetry ? (
      <Button
        disabled={pending !== null}
        data-pending={pending === "retry" ? "retry" : undefined}
        onClick={onRetry}
      >
        {/* 加载指示与原标签并存，不吞掉按钮文字。 */}
        <RefreshCw
          data-icon="inline-start"
          className={
            pending === "retry"
              ? "animate-spin motion-reduce:animate-none"
              : undefined
          }
        />
        {retryLabel}
      </Button>
    ) : null

  const content = (
    <>
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
      ) : FailureView ? (
        <FailureView title={title} message={failureMessage} pending={pending} />
      ) : (
        <div className="startup-failure" role="status">
          <h2 key={title}>
            <CircleAlert aria-hidden="true" />
            {title}
          </h2>
          <p>{failureMessage}</p>
          {pending === "retry" && (
            <p className="startup-retrying">
              <span className="startup-dot" aria-hidden="true" />
              正在重试…
            </p>
          )}
        </div>
      )}
      {retryAction && !failureInDialog && (
        <div className="startup-actions">{retryAction}</div>
      )}
      {/* 快启动保持纯呼吸点；慢启动或失败时开放阶段信息与详情。 */}
      {disclosureAvailable && DetailsView ? (
        <DetailsView
          status={status}
          steps={steps}
          pending={pending}
          open={details}
          onOpenChange={setDetails}
          retryAction={retryAction}
          exitAction={exitAction}
          copyAction={copyAction}
        />
      ) : disclosureAvailable ? (
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
            {copyAction}
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
    </>
  )

  return (
    <main
      className="startup-surface"
      data-status={status}
      data-pending={pending ?? undefined}
    >
      {content}
    </main>
  )
}
